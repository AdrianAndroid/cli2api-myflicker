"use strict";

const { EventEmitter } = require("node:events");
const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");
const fs = require("node:fs");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, { timeoutMs = 15000, intervalMs = 300, label = "condition" } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  throw new Error(`等待 ${label} 超时（${timeoutMs}ms）${lastError ? `: ${lastError.message}` : ""}`);
}

function pingRedis(host, port, timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    let finished = false;
    const done = (ok) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.on("connect", () => socket.write("PING\r\n"));
    socket.on("data", (buffer) => done(String(buffer).includes("PONG")));
    socket.on("error", () => done(false));
  });
}

const REDIS_URL_RE = /^redis(s)?:\/\/(?:[^@]*@)?([^:/]+)(?::(\d+))?/;

function parseRedisUrl(url) {
  const match = REDIS_URL_RE.exec(url || "");
  return { host: match?.[2] || "127.0.0.1", port: Number(match?.[3] || 6379) };
}

function killTree(child, signal = "SIGTERM") {
  if (!child || child.exitCode !== null || child.killed) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      /* already gone */
    }
  }
}

function waitExit(child, timeoutMs) {
  if (!child || child.exitCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

class ServiceManager extends EventEmitter {
  constructor({ projectRoot, envStore, api, logBus, setup = null }) {
    super();
    this.projectRoot = projectRoot;
    this.envStore = envStore;
    this.api = api;
    this.logBus = logBus;
    this.setup = setup;

    this.state = "stopped"; // stopped | starting | running | stopping | error
    this.mode = null; // owned | external
    this.lastError = null;
    this.health = null;
    this.startedAt = null;
    this.procs = { redis: null, worker: null, api: null };
    this.owns = { redis: false, worker: false, api: false };
    this.recent = { redis: "", worker: "", api: "" };
    this.pollTimer = null;
    this.healthMisses = 0;
    this.stepDefs = [
      { key: "redis", name: "Redis" },
      { key: "worker", name: "Celery worker" },
      { key: "api", name: "FastAPI 网关" },
      { key: "check", name: "自检 /health" },
    ];
    this.steps = this.resetSteps();
  }

  resetSteps() {
    return this.stepDefs.map((def) => ({ ...def, state: "pending", detail: "" }));
  }

  setStep(key, state, detail) {
    const step = this.steps.find((item) => item.key === key);
    if (step) {
      step.state = state;
      if (detail !== undefined) step.detail = detail;
    }
    this.emitStatus();
  }

  emitStatus() {
    this.emit("status", this.getStatus());
  }

  env() {
    return this.envStore.readAll();
  }

  apiPort() {
    return Number(this.env().API_PORT || 8000) || 8000;
  }

  redisTarget() {
    return parseRedisUrl(this.env().REDIS_URL || "redis://127.0.0.1:6379/0");
  }

  pythonBin() {
    if (this.setup) return this.setup.pythonPath();
    const candidates = [
      path.join(this.projectRoot, ".venv", "bin", "python"),
      path.join(this.projectRoot, ".venv", "Scripts", "python.exe"),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
    return process.platform === "win32" ? "python" : "python3";
  }

  spawnService(source, command, args, env, cwd) {
    const child = spawn(command, args, {
      cwd,
      env,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.procs[source] = child;
    this.owns[source] = true;
    this.recent[source] = "";

    const onData = (chunk) => {
      this.logBus.push(source, chunk);
      this.recent[source] = (this.recent[source] + chunk).slice(-20000);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", (error) => {
      this.lastError = `${source} 启动失败: ${error.message}`;
      this.logBus.push(source, `[desktop] spawn error: ${error.message}`);
      this.emitStatus();
    });
    child.on("exit", (code, signal) => {
      this.logBus.push(source, `[desktop] exited code=${code} signal=${signal}`);
      if (this.state === "starting" || this.state === "running") {
        this.state = "error";
        this.lastError = this.lastError || `${source} 已退出 (code=${code} signal=${signal})`;
        const step = this.steps.find((item) => item.key === source);
        if (step) {
          step.state = "failed";
          step.detail = `退出 code=${code}`;
        }
      }
      this.emitStatus();
    });
    return child;
  }

  async start() {
    if (this.state === "starting" || this.state === "running") return this.getStatus();
    this.state = "starting";
    this.lastError = null;
    this.steps = this.resetSteps();
    this.emitStatus();

    try {
      const env = this.envStore.childEnv();
      const port = this.apiPort();
      const redis = this.redisTarget();

      // 0) attach to an already running gateway instead of doubling it up
      const probe = await this.api.health();
      if (probe.ok) {
        this.mode = "external";
        this.state = "running";
        this.startedAt = Date.now();
        this.health = probe.data;
        this.steps = this.stepDefs.map((def) => ({ ...def, state: "done", detail: "复用已在运行的服务" }));
        this.startPolling();
        this.emitStatus();
        return this.getStatus();
      }
      if (probe.status === 401) {
        throw new Error("端口已被占用，但 API_KEY 不匹配（可能是另一个实例）");
      }

      // 0.5) runtime environment (packaged app creates its venv in userData)
      if (this.setup) {
        const info = await this.setup.probe();
        if (!info.ready) {
          throw new Error(
            `Python 运行环境未就绪（${info.error || "缺少依赖"}）——请在控制台点「初始化运行环境」，日志见 setup.log`,
          );
        }
      }

      // 1) redis
      this.setStep("redis", "active", "检测 6379 …");
      const redisAlive = await pingRedis(redis.host, redis.port);
      if (redisAlive) {
        this.setStep("redis", "done", `复用已有实例 ${redis.host}:${redis.port}`);
      } else {
        const bin = env.REDIS_BIN || "redis-server";
        this.spawnService(
          "redis",
          bin,
          ["--port", String(redis.port), "--save", "", "--appendonly", "no"],
          env,
          this.projectRoot,
        );
        await waitFor(() => pingRedis(redis.host, redis.port), {
          timeoutMs: 8000,
          label: "redis PING",
        });
        this.setStep("redis", "done", `已启动 ${bin} :${redis.port}`);
      }

      // 2) gateway
      this.setStep("api", "active", `uvicorn main:app :${port} …`);
      const python = this.pythonBin();
      this.spawnService(
        "api",
        python,
        ["-m", "uvicorn", "main:app", "--host", env.API_HOST || "127.0.0.1", "--port", String(port)],
        env,
        this.projectRoot,
      );
      const health = await waitFor(
        async () => {
          const response = await this.api.health();
          return response.ok ? response.data : null;
        },
        { timeoutMs: 40000, intervalMs: 500, label: "GET /api/myflicker/health" },
      );
      this.health = health;
      this.setStep("api", "done", `http://127.0.0.1:${port}`);

      // 3) worker (only when no worker is online: never run two, it breaks serial execution)
      if (health.worker && health.worker.online_workers > 0) {
        this.setStep("worker", "done", `复用在线 worker ×${health.worker.online_workers}`);
      } else {
        this.setStep("worker", "active", "celery --concurrency=1 …");
        this.spawnService(
          "worker",
          python,
          [
            "-m",
            "celery",
            "-A",
            "celery_tasks.celery_app",
            "worker",
            "--concurrency=1",
            "--loglevel=info",
            "-Q",
            env.CELERY_QUEUE || "myflicker",
          ],
          env,
          this.projectRoot,
        );
        await waitFor(() => /ready\./i.test(this.recent.worker) || /concurrency:/i.test(this.recent.worker), {
          timeoutMs: 30000,
          label: "celery worker ready",
        });
        await waitFor(
          async () => {
            const probe = await this.api.health();
            return probe.ok && (probe.data?.worker?.online_workers ?? 0) > 0 ? probe.data : null;
          },
          { timeoutMs: 10000, intervalMs: 500, label: "worker 注册到 broker" },
        ).catch(() => null);
        this.setStep("worker", "done", "concurrency=1（严格串行）");
      }

      // 4) final self check
      this.setStep("check", "active", "读取健康快照 …");
      const finalHealth = await this.api.health();
      this.health = finalHealth.ok ? finalHealth.data : this.health;
      this.setStep(
        "check",
        finalHealth.ok ? "done" : "failed",
        finalHealth.ok ? "服务就绪" : `health 异常: ${finalHealth.data?.detail || finalHealth.error}`,
      );

      this.mode = this.mode || "owned";
      this.state = finalHealth.ok ? "running" : "error";
      this.startedAt = Date.now();
      this.startPolling();
      this.emitStatus();
      return this.getStatus();
    } catch (error) {
      this.state = "error";
      this.lastError = error.message;
      const active = this.steps.find((step) => step.state === "active");
      if (active) {
        active.state = "failed";
        active.detail = error.message;
      }
      this.emitStatus();
      return this.getStatus();
    }
  }

  async stop() {
    if (this.state === "stopped" || this.state === "stopping") return this.getStatus();
    this.state = "stopping";
    this.stopPolling();
    this.emitStatus();

    for (const source of ["api", "worker"]) {
      const child = this.procs[source];
      if (child && this.owns[source]) {
        killTree(child, "SIGTERM");
        const exited = await waitExit(child, source === "worker" ? 10000 : 6000);
        if (!exited) killTree(child, "SIGKILL");
      }
      this.procs[source] = null;
      this.owns[source] = false;
    }

    if (this.owns.redis && this.procs.redis) {
      killTree(this.procs.redis, "SIGTERM");
      await waitExit(this.procs.redis, 5000);
    }
    this.procs.redis = null;
    this.owns.redis = false;

    this.state = "stopped";
    this.mode = null;
    this.health = null;
    this.startedAt = null;
    this.steps = this.resetSteps();
    this.emitStatus();
    return this.getStatus();
  }

  async restart() {
    await this.stop();
    await sleep(400);
    return this.start();
  }

  startPolling() {
    this.stopPolling();
    this.healthMisses = 0;
    this.pollTimer = setInterval(async () => {
      if (this.state !== "running") return;
      const response = await this.api.health();
      if (response.ok) {
        this.healthMisses = 0;
        this.health = response.data;
      } else {
        this.healthMisses += 1;
        if (this.healthMisses >= 3 && this.mode === "owned") {
          this.state = "error";
          this.lastError = `health 连续失败: ${response.error || response.status}`;
        }
      }
      this.emitStatus();
    }, 1500);
  }

  stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  getStatus() {
    const env = this.env();
    return {
      state: this.state,
      mode: this.mode,
      port: this.apiPort(),
      baseUrl: `http://127.0.0.1:${this.apiPort()}`,
      redis: this.redisTarget(),
      bin: env.MYFLICKER_BIN || "",
      cwd: env.MYFLICKER_CWD || "",
      logDir: env.LOG_DIR || "logs",
      steps: this.steps,
      health: this.health,
      queueDepth: this.health?.queue_depth ?? null,
      workers: this.health?.worker?.online_workers ?? 0,
      lastError: this.lastError,
      startedAt: this.startedAt,
      uptimeMs: this.startedAt ? Date.now() - this.startedAt : 0,
      logs: {
        redis: this.logBus.pathFor("redis"),
        worker: this.logBus.pathFor("worker"),
        api: this.logBus.pathFor("api"),
      },
    };
  }

  async shutdown() {
    this.stopPolling();
    for (const source of ["api", "worker", "redis"]) {
      const child = this.procs[source];
      if (child && this.owns[source]) killTree(child, "SIGTERM");
    }
    await sleep(1200);
    for (const source of ["api", "worker", "redis"]) {
      const child = this.procs[source];
      if (child && this.owns[source]) killTree(child, "SIGKILL");
    }
  }
}

module.exports = { ServiceManager, parseRedisUrl, pingRedis, waitFor };
