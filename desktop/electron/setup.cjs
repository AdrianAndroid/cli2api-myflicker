"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const REQUIRED_MODULES = ["fastapi", "celery", "redis", "uvicorn", "dotenv", "httpx"];

/**
 * Runtime environment bootstrap for the packaged app.
 *
 * The .app bundle only ships the Python sources (read-only, inside Resources).
 * The interpreter + dependencies live in a writable data dir
 * (~/Library/Application Support/myflicker on macOS), created on demand by
 * `install()` which the UI triggers with one click.
 */
class SetupManager {
  constructor({ backendRoot, dataDir, logBus, envStore }) {
    this.backendRoot = backendRoot;
    this.dataDir = dataDir;
    this.logBus = logBus;
    this.envStore = envStore;
    this.installing = false;
    this.lastError = null;
  }

  venvDir() {
    return path.join(this.dataDir, ".venv");
  }

  venvPython() {
    return process.platform === "win32"
      ? path.join(this.venvDir(), "Scripts", "python.exe")
      : path.join(this.venvDir(), "bin", "python");
  }

  systemPython() {
    const env = this.envStore.readAll();
    if (env.PYTHON_BIN) return env.PYTHON_BIN;
    return process.platform === "win32" ? "python" : "python3";
  }

  pythonPath() {
    const candidates = [this.venvPython(), path.join(this.backendRoot, ".venv", "bin", "python")];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
    return this.systemPython();
  }

  requirementsPath() {
    return path.join(this.backendRoot, "requirements.txt");
  }

  run(command, args, { cwd, timeoutMs = 600000, label = "" } = {}) {
    return new Promise((resolve, reject) => {
      this.logBus.push("setup", `$ ${label ? label + ": " : ""}${command} ${args.join(" ")}`);
      let child;
      try {
        child = spawn(command, args, {
          cwd: cwd || this.dataDir,
          env: { ...process.env, ...this.envStore.readAll(), PYTHONUNBUFFERED: "1" },
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error) {
        reject(new Error(`${command} 无法启动: ${error.message}`));
        return;
      }
      const timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
        reject(new Error(`${label || command} 超时（${timeoutMs}ms）`));
      }, timeoutMs);

      child.stdout.on("data", (chunk) => this.logBus.push("setup", chunk));
      child.stderr.on("data", (chunk) => this.logBus.push("setup", chunk));
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(new Error(`${command} 启动失败: ${error.message}`));
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(true);
        else reject(new Error(`${label || command} 退出码 ${code}`));
      });
    });
  }

  async probe() {
    const env = this.envStore.readAll();
    const python = this.pythonPath();
    const venvExists = fs.existsSync(this.venvPython());
    const information = {
      backendRoot: this.backendRoot,
      dataDir: this.dataDir,
      venvDir: this.venvDir(),
      venvExists,
      python,
      systemPython: this.systemPython(),
      requirements: fs.existsSync(this.requirementsPath()),
      installing: this.installing,
      ready: false,
      missingModules: [],
      error: null,
    };

    if (!information.requirements) {
      information.error = `找不到 requirements.txt（${this.requirementsPath()}）`;
      return information;
    }

    try {
      const script =
        `import importlib.util, json, sys\n` +
        `missing = [m for m in ${JSON.stringify(REQUIRED_MODULES)} if importlib.util.find_spec(m) is None]\n` +
        `print(json.dumps({"executable": sys.executable, "missing": missing}))\n`;
      const output = await new Promise((resolve, reject) => {
        const child = spawn(python, ["-c", script], {
          cwd: this.backendRoot,
          env: { ...process.env, ...env },
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error("python 自检超时"));
        }, 15000);
        child.stdout.on("data", (chunk) => (stdout += chunk));
        child.stderr.on("data", (chunk) => (stderr += chunk));
        child.on("error", (error) => {
          clearTimeout(timer);
          reject(new Error(`python 不可用: ${error.message}`));
        });
        child.on("exit", (code) => {
          clearTimeout(timer);
          if (code !== 0) reject(new Error(stderr.trim() || `python 退出码 ${code}`));
          else resolve(stdout);
        });
      });
      const parsed = JSON.parse(output.trim().split("\n").pop());
      information.python = parsed.executable || python;
      information.missingModules = parsed.missing || [];
      information.ready = information.missingModules.length === 0;
      if (!information.ready) {
        information.error = `缺少依赖: ${information.missingModules.join(", ")}`;
      }
    } catch (error) {
      information.error = error.message;
    }
    return information;
  }

  async install() {
    if (this.installing) throw new Error("初始化已在进行中");
    this.installing = true;
    this.lastError = null;
    this.logBus.push("setup", "[setup] 开始初始化 Python 运行环境");
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      const systemPython = this.systemPython();

      if (!fs.existsSync(this.venvPython())) {
        await this.run(systemPython, ["-m", "venv", this.venvDir()], { label: "创建 venv" });
      }
      const python = this.venvPython();
      await this.run(python, ["-m", "pip", "install", "--upgrade", "pip", "--quiet"], {
        label: "升级 pip",
        timeoutMs: 180000,
      });
      await this.run(python, ["-m", "pip", "install", "-r", this.requirementsPath()], {
        label: "安装依赖",
        timeoutMs: 900000,
      });
      const probe = await this.probe();
      this.logBus.push(
        "setup",
        probe.ready ? "[setup] 初始化完成，运行环境就绪" : `[setup] 初始化后自检失败: ${probe.error}`,
      );
      return probe;
    } catch (error) {
      this.lastError = error.message;
      this.logBus.push("setup", `[setup] 初始化失败: ${error.message}`);
      throw error;
    } finally {
      this.installing = false;
    }
  }
}

module.exports = { SetupManager, REQUIRED_MODULES };
