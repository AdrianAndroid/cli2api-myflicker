"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const BACKUP_TAG = ".myflicker-backup-";

function settingsPath() {
  return process.env.MYFLICKER_CLAUDE_SETTINGS || path.join(os.homedir(), ".claude", "settings.json");
}

function localBaseUrl(env) {
  const rawHost = String(env.API_HOST || "127.0.0.1").trim();
  const host = rawHost === "0.0.0.0" || rawHost === "::" ? "127.0.0.1" : rawHost;
  const port = Number(env.API_PORT || 8000) || 8000;
  return `http://${host}:${port}`;
}

function firstKey(env) {
  const single = String(env.API_KEY || "").trim();
  if (single) return single;
  for (const chunk of String(env.API_KEYS || "").split(",")) {
    const item = chunk.trim();
    if (!item) continue;
    const sep = item.indexOf(":");
    return sep >= 0 ? item.slice(sep + 1).trim() : item;
  }
  return "";
}

function maskToken(token) {
  if (!token) return "";
  if (token.length <= 8) return "••••";
  return `${token.slice(0, 3)}••••${token.slice(-4)}`;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function listBackups(file) {
  const dir = path.dirname(file);
  const prefix = path.basename(file) + BACKUP_TAG;
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => name.startsWith(prefix))
      .sort()
      .map((name) => path.join(dir, name));
  } catch {
    return [];
  }
}

function status(env) {
  const file = settingsPath();
  const exists = fs.existsSync(file);
  const data = exists ? readJson(file) : {};
  const settings = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  const envs =
    settings.env && typeof settings.env === "object" && !Array.isArray(settings.env)
      ? settings.env
      : {};
  const current = typeof envs.ANTHROPIC_BASE_URL === "string" ? envs.ANTHROPIC_BASE_URL : "";
  const token = typeof envs.ANTHROPIC_AUTH_TOKEN === "string" ? envs.ANTHROPIC_AUTH_TOKEN : "";
  const localUrl = localBaseUrl(env);
  const normalize = (value) => String(value || "").replace(/\/+$/, "");
  const backups = listBackups(file);
  return {
    path: file,
    exists,
    validJson: !exists || data !== null,
    baseUrl: current,
    tokenMasked: maskToken(token),
    localUrl,
    pointsToLocal: Boolean(current) && normalize(current) === normalize(localUrl),
    backupPath: backups.length ? backups[backups.length - 1] : "",
  };
}

function configure(env) {
  const file = settingsPath();
  const token = firstKey(env);
  if (!token) throw new Error("请先在 .env 配置 API_KEY 或 API_KEYS");

  let data = {};
  if (fs.existsSync(file)) {
    data = readJson(file);
    if (data === null) throw new Error(`无法解析 ${file}，请先手动修正 JSON`);
    if (typeof data !== "object" || Array.isArray(data)) {
      throw new Error(`${file} 不是 JSON 对象，已中止，未修改文件`);
    }
  }

  let backupPath = "";
  if (fs.existsSync(file)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    backupPath = `${file}${BACKUP_TAG}${stamp}`;
    fs.copyFileSync(file, backupPath);
    fs.chmodSync(backupPath, 0o600);
  }

  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!data.env || typeof data.env !== "object" || Array.isArray(data.env)) data.env = {};
  data.env.ANTHROPIC_BASE_URL = localBaseUrl(env);
  data.env.ANTHROPIC_AUTH_TOKEN = token;
  delete data.env.ANTHROPIC_API_KEY;

  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return { ...status(env), backupPath };
}

function restore(env) {
  const file = settingsPath();
  const backups = listBackups(file);
  if (!backups.length) throw new Error("没有可恢复的备份");
  const latest = backups[backups.length - 1];
  fs.copyFileSync(latest, file);
  fs.chmodSync(file, 0o600);
  return { ...status(env), restoredFrom: latest };
}

module.exports = { status, configure, restore, settingsPath, localBaseUrl, maskToken };
