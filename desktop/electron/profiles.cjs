"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { safeStorage } = require("electron");

/**
 * Roles and connection profiles.
 *
 * A profile is "how to reach an API": baseUrl + key (+ model/timeout).
 * The built-in "local" profile is derived from the repo/app .env so existing
 * behaviour is unchanged; extra profiles are user defined and may point at
 * another machine on the LAN.
 *
 * Keys are encrypted with the OS keychain (safeStorage) when available; if it
 * is not, we keep them plaintext in the profile file and flag it.
 */
class ProfileStore {
  constructor(dataDir, envStore) {
    this.file = path.join(dataDir, "profiles.json");
    this.dataDir = dataDir;
    this.envStore = envStore;
    this.state = this.load();
  }

  defaults() {
    return { role: "provider", activeId: null, profiles: [], onboarded: false };
  }

  load() {
    try {
      const raw = fs.readFileSync(this.file, "utf8");
      const parsed = JSON.parse(raw);
      return {
        role: parsed.role === "client" ? "client" : "provider",
        activeId: parsed.activeId || null,
        profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [],
        onboarded: parsed.onboarded !== false,
      };
    } catch {
      return this.defaults();
    }
  }

  persist() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.state, null, 2), { mode: 0o600 });
  }

  /**
   * The local profile always mirrors .env, so changing API_PORT/API_KEY in the
   * service settings keeps working without touching the profile store.
   */
  localProfile() {
    const env = this.envStore.readAll();
    const port = Number(env.API_PORT || 8000) || 8000;
    const host = env.API_HOST === "0.0.0.0" ? "127.0.0.1" : env.API_HOST || "127.0.0.1";
    return {
      id: "local",
      name: "本机服务",
      kind: "local",
      baseUrl: `http://${host}:${port}`,
      model: env.OPENAI_MODEL_ID || "myflicker-agent",
      timeout: Number(env.DEFAULT_TIMEOUT || 600) || 600,
      key: env.API_KEY || "",
      adminKey: env.ADMIN_API_KEY || "",
      builtin: true,
    };
  }

  _decrypt(profile) {
    if (!profile.secret) return "";
    try {
      if (profile.secret.encrypted && safeStorage.isEncryptionAvailable()) {
        return safeStorage.decryptString(Buffer.from(profile.secret.value, "base64"));
      }
      return Buffer.from(profile.secret.value, "base64").toString("utf8");
    } catch {
      return "";
    }
  }

  _encrypt(key) {
    const available = safeStorage.isEncryptionAvailable();
    const raw = Buffer.from(key, "utf8");
    const value = available ? safeStorage.encryptString(key) : raw;
    return { encrypted: available, value: Buffer.from(value).toString("base64") };
  }

  /** Profile with the key material resolved (main process only). */
  resolve(id) {
    if (!id || id === "local") return this.localProfile();
    const stored = this.state.profiles.find((item) => item.id === id);
    if (!stored) return null;
    return {
      ...stored,
      key: this._decrypt(stored),
      adminKey: "",
    };
  }

  /** Profile without the key, for the renderer. */
  mask(profile) {
    if (!profile) return null;
    const { secret, key, adminKey, ...rest } = profile;
    return { ...rest, hasKey: Boolean(key || secret) };
  }

  list() {
    const all = [this.localProfile(), ...this.state.profiles];
    return {
      role: this.state.role,
      activeId: this.activeProfileId(),
      profiles: all.map((profile) => this.mask(profile)),
    };
  }

  activeProfileId() {
    const stored = this.state.activeId;
    if (!stored) return "local";
    if (stored === "local") return "local";
    return this.state.profiles.some((item) => item.id === stored) ? stored : "local";
  }

  active() {
    return this.resolve(this.activeProfileId());
  }

  setRole(role) {
    this.state.role = role === "client" ? "client" : "provider";
    this.state.onboarded = true;
    this.persist();
    return this.state.role;
  }

  activate(id) {
    const profile = this.resolve(id);
    if (!profile) throw new Error(`unknown profile: ${id}`);
    this.state.activeId = profile.id;
    this.persist();
    return this.mask(profile);
  }

  upsert(input) {
    const id = input.id && input.id !== "local" ? input.id : `p-${Date.now().toString(36)}`;
    const existing = this.state.profiles.find((item) => item.id === id);
    const base = {
      id,
      name: (input.name || "新连接").trim().slice(0, 40),
      kind: "remote",
      baseUrl: String(input.baseUrl || "").replace(/\/+$/, ""),
      model: input.model || "myflicker-agent",
      timeout: Number(input.timeout) || 600,
      createdAt: existing?.createdAt || new Date().toISOString(),
    };
    if (!/^https?:\/\//.test(base.baseUrl)) throw new Error("baseUrl must start with http(s)://");

    const hasNewKey = typeof input.key === "string" && input.key.length > 0 && input.key !== "••••••••";
    const merged = { ...(existing || {}), ...base };
    if (hasNewKey) merged.secret = this._encrypt(input.key);
    if (!existing && !hasNewKey) throw new Error("API key is required");

    const index = this.state.profiles.findIndex((item) => item.id === id);
    if (index >= 0) this.state.profiles[index] = merged;
    else this.state.profiles.push(merged);
    this.persist();
    return this.mask(this.resolve(id));
  }

  remove(id) {
    this.state.profiles = this.state.profiles.filter((item) => item.id !== id);
    if (this.state.activeId === id) this.state.activeId = "local";
    this.persist();
    return this.list();
  }

  /** myflicker://<base64url({u,k,n})> — paste to prefill the connect form. */
  exportLink(id) {
    const profile = this.resolve(id);
    if (!profile) throw new Error(`unknown profile: ${id}`);
    const payload = { u: profile.baseUrl, k: profile.key, n: profile.name };
    return `myflicker://${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
  }

  static parseLink(link) {
    const match = /^myflicker:\/\/(.+)$/.exec(String(link || "").trim());
    if (!match) throw new Error("invalid connection string");
    let payload;
    try {
      payload = JSON.parse(Buffer.from(match[1], "base64url").toString("utf8"));
    } catch {
      throw new Error("connection string is not valid base64/json");
    }
    if (!payload || typeof payload.u !== "string") throw new Error("connection string is missing a URL");
    return {
      name: typeof payload.n === "string" && payload.n ? payload.n : "共享连接",
      baseUrl: payload.u,
      key: typeof payload.k === "string" ? payload.k : "",
    };
  }
}

module.exports = { ProfileStore };
