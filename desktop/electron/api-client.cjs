"use strict";

/**
 * The only place the desktop shell talks HTTP to a gateway.
 *
 * Which gateway is decided by a resolver (the active connection profile):
 *   { baseUrl, key, adminKey?, model?, timeout? }
 * The built-in profile resolves to the local service from .env; user profiles
 * can point at another machine on the LAN. Keys never leave the main process.
 */
class ApiClient {
  constructor(getProfile) {
    this.getProfile = getProfile;
  }

  profile() {
    try {
      return this.getProfile() || {};
    } catch {
      return {};
    }
  }

  base() {
    const raw = this.profile().baseUrl || "http://127.0.0.1:8000";
    return String(raw).replace(/\/+$/, "");
  }

  port() {
    try {
      return new URL(this.base()).port || "80";
    } catch {
      return "8000";
    }
  }

  taskKey() {
    return this.profile().key || "";
  }

  adminKey() {
    return this.profile().adminKey || this.taskKey();
  }

  model() {
    return this.profile().model || "myflicker-agent";
  }

  timeout() {
    return Number(this.profile().timeout) || 600;
  }

  async request(method, pathname, { body, admin = false, timeoutMs = 20000 } = {}) {
    const headers = { "X-API-Key": admin ? this.adminKey() : this.taskKey() };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    try {
      const response = await fetch(`${this.base()}${pathname}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await response.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = { raw: text };
      }
      return { ok: response.ok, status: response.status, data };
    } catch (error) {
      return { ok: false, status: 0, data: null, error: `${error.name}: ${error.message}` };
    }
  }

  health() {
    return this.request("GET", "/api/myflicker/health", { timeoutMs: 4000 });
  }

  models() {
    return this.request("GET", "/v1/models", { timeoutMs: 4000 });
  }

  submit(payload) {
    return this.request("POST", "/api/myflicker/submit", { body: payload });
  }

  result(taskId, { includeEvents = false } = {}) {
    const query = includeEvents ? "?include_events=true" : "";
    return this.request("GET", `/api/myflicker/result/${taskId}${query}`);
  }

  workspaces(path = "") {
    const query = path ? `?path=${encodeURIComponent(path)}` : "";
    return this.request("GET", `/api/myflicker/workspaces${query}`, { timeoutMs: 8000 });
  }

  listTasks(limit = 20) {
    return this.request("GET", `/api/myflicker/tasks?limit=${limit}`, { admin: true });
  }

  cancel(taskId) {
    return this.request("POST", `/api/myflicker/tasks/${taskId}/cancel`);
  }
}

module.exports = { ApiClient };
