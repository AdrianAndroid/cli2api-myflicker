"use strict";

/**
 * The only place the desktop shell talks HTTP to the gateway.
 * Keys never leave the main process, so the renderer cannot leak them.
 */
class ApiClient {
  constructor(envStore) {
    this.envStore = envStore;
  }

  env() {
    return this.envStore.readAll();
  }

  port() {
    return Number(this.env().API_PORT || 8000) || 8000;
  }

  base() {
    return `http://127.0.0.1:${this.port()}`;
  }

  taskKey() {
    return this.env().API_KEY || "";
  }

  adminKey() {
    return this.env().ADMIN_API_KEY || this.taskKey();
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

  submit(payload) {
    return this.request("POST", "/api/myflicker/submit", { body: payload });
  }

  result(taskId, { includeEvents = false } = {}) {
    const query = includeEvents ? "?include_events=true" : "";
    return this.request("GET", `/api/myflicker/result/${taskId}${query}`);
  }

  listTasks(limit = 20) {
    return this.request("GET", `/api/myflicker/tasks?limit=${limit}`, { admin: true });
  }

  cancel(taskId) {
    return this.request("POST", `/api/myflicker/tasks/${taskId}/cancel`);
  }
}

module.exports = { ApiClient };
