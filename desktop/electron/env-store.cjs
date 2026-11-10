"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * .env reader/writer that preserves comments, blank lines and key order.
 * The file stays the single source of truth for both the gateway and the
 * desktop shell, so no second config layer is introduced.
 */
class EnvStore {
  constructor(envPath) {
    this.envPath = envPath;
  }

  exists() {
    return fs.existsSync(this.envPath);
  }

  readLines() {
    if (!this.exists()) return [];
    return fs.readFileSync(this.envPath, "utf8").split(/\r?\n/);
  }

  readAll() {
    const out = {};
    for (const line of this.readLines()) {
      const parsed = EnvStore.parseLine(line);
      if (parsed) out[parsed.key] = parsed.value;
    }
    return out;
  }

  static parseLine(line) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return null;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) return null;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    return { key, value };
  }

  /** Merge patch into the file, keeping existing order and comments. */
  setValues(patch) {
    const lines = this.readLines();
    const pending = new Map(Object.entries(patch));
    const result = [];
    for (const line of lines) {
      const parsed = EnvStore.parseLine(line);
      if (parsed && pending.has(parsed.key)) {
        result.push(`${parsed.key}=${pending.get(parsed.key)}`);
        pending.delete(parsed.key);
      } else {
        result.push(line);
      }
    }
    if (pending.size > 0) {
      if (result.length && result[result.length - 1] !== "") result.push("");
      for (const [key, value] of pending) result.push(`${key}=${value}`);
    }
    while (result.length && result[result.length - 1] === "") result.pop();
    fs.mkdirSync(path.dirname(this.envPath), { recursive: true });
    fs.writeFileSync(this.envPath, result.join("\n") + "\n", { mode: 0o600 });
    return this.readAll();
  }

  /** Env for spawning backend processes: inherited env + .env values. */
  childEnv(extra = {}) {
    const merged = { ...process.env, ...this.readAll(), ...extra };
    return merged;
  }
}

module.exports = { EnvStore };
