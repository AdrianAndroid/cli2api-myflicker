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
const api = new ApiClient(envStore);
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

async function currentStatus() {
  const info = await refreshSetup();
  return mergeStatus(manager.getStatus(), info);
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
    query: { tab: process.env.MYFLICKER_DESKTOP_TAB || "" },
  });

  manager.on("status", (status) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send("status:update", mergeStatus(status, setupCache));
    }
  });

  win.on("closed", () => {
    win = null;
  });
}

// ---------------------------------------------------------------- service ---
ipcMain.handle("status:get", () => currentStatus());
ipcMain.handle("service:start", async () => {
  const started = await manager.start();
  const info = await refreshSetup(true);
  return mergeStatus(started, info);
});
ipcMain.handle("service:stop", async () => {
  const stopped = await manager.stop();
  return mergeStatus(stopped, setupCache);
});
ipcMain.handle("service:restart", async () => {
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
  bootstrapEnv();
  createWindow();
  await refreshSetup(true);

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
