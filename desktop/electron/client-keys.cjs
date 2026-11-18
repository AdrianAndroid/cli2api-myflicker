"use strict";

const crypto = require("node:crypto");

const MAX_LABEL = 16;

function keyLabel(key) {
  return `key-${crypto.createHash("sha256").update(key, "utf8").digest("hex").slice(0, 12)}`.slice(
    0,
    MAX_LABEL,
  );
}

function parseApiKeys(raw) {
  const entries = [];
  const seenLabels = new Set();
  for (const chunk of String(raw || "").split(",")) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    const sep = trimmed.indexOf(":");
    const label = sep >= 0 ? trimmed.slice(0, sep).trim() : keyLabel(trimmed);
    const key = sep >= 0 ? trimmed.slice(sep + 1).trim() : trimmed.trim();
    if (!key || seenLabels.has(label)) continue;
    seenLabels.add(label);
    entries.push({ label, key, source: "API_KEYS" });
  }
  return entries;
}

function parseClientKeys(env) {
  const source = env || {};
  const entries = parseApiKeys(source.API_KEYS);
  const legacy = String(source.API_KEY || "").trim();
  if (legacy && !entries.some((entry) => entry.key === legacy)) {
    entries.push({ label: "default", key: legacy, source: "API_KEY" });
  }
  const seenKeys = new Set();
  return entries.filter((entry) => {
    if (seenKeys.has(entry.key)) return false;
    seenKeys.add(entry.key);
    return true;
  });
}

function clientKeysFromEnv(env) {
  return parseClientKeys(env);
}

module.exports = { parseClientKeys, clientKeysFromEnv, keyLabel };
