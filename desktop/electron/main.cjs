"use strict";

const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { EnvStore } = require("./env-store.cjs");
const { LogBus } = require("./logs.cjs");
const { ApiClient } = require("./api-client.cjs");
const { ServiceManager } = require("./service-manager.cjs");
const { SetupManager } = require("./setup.cjs");
const { ProfileStore } = require("./profiles.cjs");

const SECRET_KEYS = new Set(["API_KEY", "ADMIN_API_KEY"]);
const MASK = "••••••••";

/**
 * Dev: repo root (main.py lives there).
 * Packaged: Resources/backend (extraResources), read-only.
 */
const backendRoot = process.env.MYFLICKER_PROJECT_ROOT
  ? path.resolve(process.env.MYFLICKER_PROJECT_ROOT)
  : app.isPackaged
    ? path.join(process.resourcesPath, "backend")
    : path.resolve(__dirname, "..", "..");

/**
 * Writable data dir: .env, logs and .venv live here, never inside the bundle.
 * Tests MUST point MYFLICKER_DESKTOP_DATA_DIR at a throwaway dir so they never
 * touch the real config, logs or services.
 */
const dataDir = process.env.MYFLICKER_DESKTOP_DATA_DIR
  ? path.resolve(process.env.MYFLICKER_DESKTOP_DATA_DIR)
  : app.isPackaged
    ? app.getPath("userData")
    : backendRoot;
const envPath = path.join(dataDir, ".env");

const logBus = new LogBus(dataDir);
const envStore = new EnvStore(envPath);
const profiles = new ProfileStore(dataDir, envStore);
const api = new ApiClient(() => profiles.active());
const setup = new SetupManager({ backendRoot, dataDir, logBus, envStore });
const manager = new ServiceManager({ projectRoot: backendRoot, envStore, api, logBus, setup });

// isolated data dir must also own the single-instance lock, otherwise a test run
// would be rejected while the user's app is open
if (process.env.MYFLICKER_DESKTOP_DATA_DIR) {
  app.setPath("userData", path.resolve(process.env.MYFLICKER_DESKTOP_DATA_DIR));
}

let win = null;
let quitting = false;
let setupCache = null;
let setupProbedAt = 0;
let clientHealth = null;
let clientProbeTimer = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

function detectRedisBin() {
  const candidates = [
    "/opt/homebrew/bin/redis-server",
    "/usr/local/bin/redis-server",
    "/usr/bin/redis-server",
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return "redis-server";
}

/** First run of the packaged app: create a writable .env derived from .env.example. */
function bootstrapEnv() {
  if (fs.existsSync(envPath)) return;
  const examplePath = path.join(backendRoot, ".env.example");
  if (!fs.existsSync(examplePath)) {
    logBus.push("setup", `[setup] 未找到 ${examplePath}，跳过 .env 初始化`);
    return;
  }
  fs.mkdirSync(dataDir, { recursive: true });
  const example = fs.readFileSync(examplePath, "utf8");
  fs.writeFileSync(envPath, example, { mode: 0o600 });

  const defaults = {};
  for (const line of example.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index > 0) defaults[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }

  const workspace = path.join(dataDir, "workspace");
  fs.mkdirSync(workspace, { recursive: true });
  envStore.setValues({
    API_KEY: crypto.randomBytes(24).toString("base64url"),
    LOG_DIR: path.join(dataDir, "logs"),
    WORKSPACE_ROOT: path.join(dataDir, "workspace"),
    MYFLICKER_CWD: workspace,
    MYFLICKER_BIN: defaults.MYFLICKER_BIN || "myflicker",
    REDIS_BIN: detectRedisBin(),
  });
  logBus.push("setup", `[setup] 已生成可写配置 ${envPath}`);
}

function maskEnv(env) {
  const masked = {};
  for (const [key, value] of Object.entries(env)) {
    masked[key] = SECRET_KEYS.has(key) && value ? MASK : value;
  }
  return masked;
}

async function refreshSetup(force = false) {
  const stale = !setupCache || Date.now() - setupProbedAt > 5000 || setup.installing;
  if (force || stale) {
    setupCache = await setup.probe();
    setupProbedAt = Date.now();
  }
  return setupCache;
}

function mergeStatus(status, info) {
  return { ...status, setup: info };
}

/** True when the app should talk to a gateway it does not manage locally. */
function remoteMode() {
  const profile = profiles.active();
  return profiles.state.role === "client" || profile?.kind === "remote";
}

async function currentStatus() {
  const role = profiles.state.role;
  const base = manager.getStatus();
  const profile = profiles.active();
  const masked = profiles.mask(profile);
  const remote = remoteMode();
  const onboarded = Boolean(profiles.state.onboarded);

  if (remote) {
    return {
      ...base,
      role,
      profile: masked,
      onboarded,
      setup: null,
      connected: Boolean(clientHealth),
      baseUrl: api.base(),
      port: api.port(),
      state: clientHealth ? "running" : "stopped",
      health: clientHealth,
      queueDepth: clientHealth?.queue_depth ?? null,
      workers: clientHealth?.worker?.online_workers ?? 0,
      lastError: clientHealth ? null : "无法连接到 API 服务",
    };
  }

  const info = await refreshSetup();
  return { ...mergeStatus(base, info), role, profile: masked, onboarded, connected: base.state === "running" };
}

function decorate(status) {
  const role = profiles.state.role;
  const remote = remoteMode();
  return {
    ...status,
    role,
    profile: profiles.mask(profiles.active()),
    onboarded: Boolean(profiles.state.onboarded),
    baseUrl: remote ? api.base() : status.baseUrl,
    connected: remote ? Boolean(clientHealth) : status.state === "running",
  };
}

async function probeClient() {
  const response = await api.health();
  clientHealth = response.ok ? response.data : null;
  if (win && !win.isDestroyed()) {
    win.webContents.send("status:update", decorate(await currentStatus()));
  }
}

function ensureClientProbe() {
  if (!remoteMode()) {
    if (clientProbeTimer) clearInterval(clientProbeTimer);
    clientProbeTimer = null;
    return;
  }
  if (clientProbeTimer) return;
  void probeClient();
  clientProbeTimer = setInterval(() => void probeClient(), 3000);
}

/** Headless mode: capture runs must never steal focus from the user. */
const HEADLESS = Boolean(process.env.MYFLICKER_DESKTOP_CAPTURE);

function createWindow() {
  win = new BrowserWindow({
    show: !HEADLESS,
    focusable: !HEADLESS,
    width: 1320,
    height: 860,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: "#0f1115",
    title: "myflicker 控制台",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  win.loadFile(path.join(__dirname, "..", "dist", "index.html"), {
    query: {
      tab: process.env.MYFLICKER_DESKTOP_TAB || "",
      prompt: process.env.MYFLICKER_DESKTOP_CHAT_PROMPT || "",
    },
  });

  manager.on("status", (status) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send("status:update", decorate(mergeStatus(status, setupCache)));
    }
  });

  win.on("closed", () => {
    win = null;
  });
}

// ---------------------------------------------------------------- service ---
ipcMain.handle("status:get", () => currentStatus());
function providerOnly() {
  if (profiles.state.role !== "provider") {
    return { ok: false, error: "当前为「连接使用」角色，无法控制本机服务" };
  }
  return null;
}

ipcMain.handle("service:start", async () => {
  const denied = providerOnly();
  if (denied) return { ...manager.getStatus(), ...denied };
  const started = await manager.start();
  const info = await refreshSetup(true);
  return mergeStatus(started, info);
});
ipcMain.handle("service:stop", async () => {
  const stopped = await manager.stop();
  return mergeStatus(stopped, setupCache);
});
ipcMain.handle("service:restart", async () => {
  const denied = providerOnly();
  if (denied) return { ...manager.getStatus(), ...denied };
  const restarted = await manager.restart();
  const info = await refreshSetup(true);
  return mergeStatus(restarted, info);
});
ipcMain.handle("net:urls", () => {
  const port = manager.apiPort();
  const urls = [];
  for (const [name, infos] of Object.entries(os.networkInterfaces())) {
    for (const info of infos || []) {
      if (info.family === "IPv4" && !info.internal) {
        urls.push({ iface: name, url: `http://${info.address}:${port}` });
      }
    }
  }
  urls.push({ iface: "loopback", url: `http://127.0.0.1:${port}` });
  urls.push({ iface: "bonjour", url: `http://${os.hostname().split(".")[0]}.local:${port}` });
  return urls;
});

// ------------------------------------------------------------------ setup ---
ipcMain.handle("setup:status", () => refreshSetup(true));
ipcMain.handle("setup:init", async () => {
  const info = await setup.install();
  setupCache = info;
  setupProbedAt = Date.now();
  return info;
});

// ------------------------------------------------------------------ tasks ---
ipcMain.handle("tasks:submit", (_event, payload) => api.submit(payload));
ipcMain.handle("tasks:result", (_event, taskId, includeEvents) =>
  api.result(taskId, { includeEvents: Boolean(includeEvents) }),
);
ipcMain.handle("tasks:list", (_event, limit) => api.listTasks(limit || 20));
ipcMain.handle("tasks:cancel", (_event, taskId) => api.cancel(taskId));

// ------------------------------------------------------------------- chat ---
// The console talks to the public OpenAI-compatible API, exactly like a LAN
// client would: same base URL, same key, same protocol. Keys stay in main.
const chatStreams = new Map();

ipcMain.handle("chat:start", async (_event, payload) => {
  const requestId = payload && payload.requestId;
  if (!requestId) return { ok: false, error: "missing requestId" };
  const controller = new AbortController();
  chatStreams.set(requestId, controller);
  const send = (message) => {
    if (win && !win.isDestroyed()) win.webContents.send("chat:event", { requestId, ...message });
  };

  (async () => {
    try {
      const response = await fetch(`${api.base()}/v1/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${api.taskKey()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: api.model(), ...payload.body, stream: true, events: true }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        send({ type: "error", status: response.status, message: await response.text() });
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let index;
        while ((index = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          for (const line of block.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (data === "[DONE]") {
              send({ type: "done" });
              return;
            }
            try {
              send({ type: "chunk", data: JSON.parse(data) });
            } catch {
              /* ignore keep-alive / malformed frames */
            }
          }
        }
      }
      send({ type: "done" });
    } catch (error) {
      if (error.name !== "AbortError") send({ type: "error", message: `${error.name}: ${error.message}` });
      else send({ type: "aborted" });
    } finally {
      chatStreams.delete(requestId);
    }
  })();

  return { ok: true, requestId };
});

ipcMain.handle("chat:abort", (_event, requestId) => {
  const controller = chatStreams.get(requestId);
  if (controller) controller.abort();
  return { ok: true };
});

// --------------------------------------------------------------- profiles ---
ipcMain.handle("profiles:list", () => profiles.list());
ipcMain.handle("profiles:upsert", (_event, input) => profiles.upsert(input || {}));
ipcMain.handle("profiles:remove", (_event, id) => profiles.remove(id));
ipcMain.handle("profiles:activate", async (_event, id) => {
  const profile = profiles.activate(id);
  ensureClientProbe();
  if (remoteMode()) await probeClient();
  return { profile, status: await currentStatus() };
});
ipcMain.handle("profiles:export", (_event, id) => profiles.exportLink(id || profiles.activeProfileId()));
ipcMain.handle("profiles:import", (_event, link) => ProfileStore.parseLink(link));
ipcMain.handle("profiles:probe", async (_event, input) => {
  const baseUrl = String(input?.baseUrl || "").replace(/\/+$/, "");
  const key = String(input?.key || "");
  if (!/^https?:\/\//.test(baseUrl)) return { ok: false, error: "地址必须以 http:// 或 https:// 开头" };
  const headers = { "X-API-Key": key };
  try {
    const health = await fetch(`${baseUrl}/api/myflicker/health`, {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    const healthData = await health.json().catch(() => null);
    if (!health.ok) {
      return { ok: false, stage: "health", status: health.status, error: healthData?.error?.message || `HTTP ${health.status}` };
    }
    const models = await fetch(`${baseUrl}/v1/models`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!models.ok) {
      return { ok: false, stage: "models", status: models.status, error: "鉴权失败或该服务未启用 /v1" };
    }
    const modelsData = await models.json().catch(() => null);
    return {
      ok: true,
      health: healthData,
      models: (modelsData?.data || []).map((item) => item.id),
    };
  } catch (error) {
    return { ok: false, stage: "network", error: `${error.name}: ${error.message}` };
  }
});

ipcMain.handle("app:role", async (_event, role) => {
  if (role) {
    profiles.setRole(role);
    ensureClientProbe();
    await refreshSetup(true).catch(() => null);
  }
  return currentStatus();
});

// ------------------------------------------------------------------- logs ---
ipcMain.handle("logs:tail", (_event, source, cursor) => logBus.tail(source, Number(cursor) || 0));
ipcMain.handle("logs:open", (_event, source) => shell.openPath(logBus.pathFor(source)));
ipcMain.handle("shell:open", (_event, target) => shell.openPath(target));

// -------------------------------------------------------------------- env ---
ipcMain.handle("env:read", () => ({ masked: maskEnv(envStore.readAll()), path: envStore.envPath }));
ipcMain.handle("env:save", (_event, patch) => {
  const safePatch = {};
  for (const [key, value] of Object.entries(patch || {})) {
    if (SECRET_KEYS.has(key) && (value === MASK || value === undefined)) continue;
    safePatch[key] = value;
  }
  envStore.setValues(safePatch);
  return { masked: maskEnv(envStore.readAll()), path: envStore.envPath };
});
ipcMain.handle("env:rotate", (_event, key) => {
  const name = SECRET_KEYS.has(key) ? key : "API_KEY";
  const value = crypto.randomBytes(24).toString("base64url");
  envStore.setValues({ [name]: value });
  return { key: name, value, masked: maskEnv(envStore.readAll()) };
});

ipcMain.handle("dialog:file", async () => {
  const result = await dialog.showOpenDialog(win, { properties: ["openFile"] });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle("dialog:dir", async () => {
  const result = await dialog.showOpenDialog(win, { properties: ["openDirectory", "createDirectory"] });
  return result.canceled ? null : result.filePaths[0];
});

// ------------------------------------------------------------------- app ----
app.whenReady().then(async () => {
  if (HEADLESS && app.dock) app.dock.hide();
  if (profiles.state.role === "provider") {
    bootstrapEnv();
    await refreshSetup(true).catch(() => null);
  }
  createWindow();
  ensureClientProbe();

  const capturePath = process.env.MYFLICKER_DESKTOP_CAPTURE;
  if (capturePath) {
    try {
      if (process.env.MYFLICKER_DESKTOP_INIT === "1") {
        try {
          await setup.install();
        } catch (error) {
          console.error("[desktop] setup failed", error);
        }
        await refreshSetup(true);
      }
      if (process.env.MYFLICKER_DESKTOP_AUTOSTART === "1") await manager.start();

      // headless-only test hook: preload localStorage (e.g. seeded sessions)
      const seedRaw = process.env.MYFLICKER_DESKTOP_STORAGE_SEED;
      if (HEADLESS && seedRaw) {
        try {
          const seed = JSON.parse(seedRaw);
          await new Promise((resolve) => {
            if (win.webContents.isLoading()) win.webContents.once("did-finish-load", resolve);
            else resolve();
          });
          await win.webContents.executeJavaScript(
            `(() => { const seed = ${JSON.stringify(seed)}; for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v)); })()`,
          );
          win.webContents.reload();
          await new Promise((resolve) => setTimeout(resolve, 1000));
        } catch (error) {
          console.error("[desktop] storage seed failed", error);
        }
      }

      const delayMs = Number(process.env.MYFLICKER_DESKTOP_CAPTURE_DELAY_MS || 3000);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      const image = await win.webContents.capturePage();
      fs.writeFileSync(capturePath, image.toPNG());
      console.log(`[desktop] captured ${capturePath}`);
    } catch (error) {
      console.error("[desktop] capture failed", error);
    }
    if (process.env.MYFLICKER_DESKTOP_SMOKE === "1") {
      await manager.shutdown();
      app.exit(0);
    }
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", async (event) => {
  if (quitting) return;
  if (process.env.STOP_ON_QUIT === "0") return;
  event.preventDefault();
  quitting = true;
  try {
    await manager.shutdown();
  } finally {
    app.exit(0);
  }
});
