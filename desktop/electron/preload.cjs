"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  getStatus: () => ipcRenderer.invoke("status:get"),
  start: () => ipcRenderer.invoke("service:start"),
  stop: () => ipcRenderer.invoke("service:stop"),
  restart: () => ipcRenderer.invoke("service:restart"),
  onStatus: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on("status:update", handler);
    return () => ipcRenderer.removeListener("status:update", handler);
  },

  submit: (payload) => ipcRenderer.invoke("tasks:submit", payload),
  result: (taskId, includeEvents) => ipcRenderer.invoke("tasks:result", taskId, includeEvents),
  listTasks: (limit) => ipcRenderer.invoke("tasks:list", limit),
  cancel: (taskId) => ipcRenderer.invoke("tasks:cancel", taskId),

  chatStart: (payload) => ipcRenderer.invoke("chat:start", payload),
  chatAbort: (requestId) => ipcRenderer.invoke("chat:abort", requestId),
  onChatEvent: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("chat:event", handler);
    return () => ipcRenderer.removeListener("chat:event", handler);
  },

  tailLogs: (source, cursor) => ipcRenderer.invoke("logs:tail", source, cursor),
  openLog: (source) => ipcRenderer.invoke("logs:open", source),

  readEnv: () => ipcRenderer.invoke("env:read"),
  saveEnv: (patch) => ipcRenderer.invoke("env:save", patch),
  rotateKey: (key) => ipcRenderer.invoke("env:rotate", key),

  pickFile: () => ipcRenderer.invoke("dialog:file"),
  pickDir: () => ipcRenderer.invoke("dialog:dir"),
  openPath: (target) => ipcRenderer.invoke("shell:open", target),

  netUrls: () => ipcRenderer.invoke("net:urls"),
  listWorkspaces: (path) => ipcRenderer.invoke("workspaces:list", path),
  listChanges: (path) => ipcRenderer.invoke("changes:list", path),
  changeDiff: (path, file) => ipcRenderer.invoke("changes:diff", path, file),

  getRole: () => ipcRenderer.invoke("app:role"),
  setRole: (role) => ipcRenderer.invoke("app:role", role),
  listProfiles: () => ipcRenderer.invoke("profiles:list"),
  upsertProfile: (input) => ipcRenderer.invoke("profiles:upsert", input),
  removeProfile: (id) => ipcRenderer.invoke("profiles:remove", id),
  activateProfile: (id) => ipcRenderer.invoke("profiles:activate", id),
  exportProfile: (id) => ipcRenderer.invoke("profiles:export", id),
  importProfile: (link) => ipcRenderer.invoke("profiles:import", link),
  probeProfile: (input) => ipcRenderer.invoke("profiles:probe", input),

  setupStatus: () => ipcRenderer.invoke("setup:status"),
  setupInit: () => ipcRenderer.invoke("setup:init"),
});
