"use strict";

const fs = require("node:fs");
const path = require("node:path");

const MAX_LINES = 3000;
const MAX_BYTES = Number(process.env.MYFLICKER_DESKTOP_LOG_MAX_BYTES || 20 * 1024 * 1024);
const BACKUPS = Number(process.env.MYFLICKER_DESKTOP_LOG_BACKUPS || 5);
const RETENTION_DAYS = Number(process.env.MYFLICKER_DESKTOP_LOG_RETENTION_DAYS || 7);

/**
 * In-memory ring buffer + on-disk log for every backend process the shell owns.
 * The renderer only ever reads through `tail()`, so a runaway process cannot
 * flood IPC with unbounded data.
 */
class LogBus {
  constructor(projectRoot) {
    this.dir = path.join(projectRoot, "logs", "desktop");
    fs.mkdirSync(this.dir, { recursive: true });
    this.buffers = new Map(); // source -> {lines: [], cursor: number}
    this.sizes = new Map();
    this.prune();
  }

  ensure(source) {
    if (!this.buffers.has(source)) this.buffers.set(source, { lines: [], cursor: 0 });
    return this.buffers.get(source);
  }

  file(source) {
    return path.join(this.dir, `${source}.log`);
  }

  prune() {
    const cutoff = Date.now() - RETENTION_DAYS * 86400000;
    let entries = [];
    try {
      entries = fs.readdirSync(this.dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const target = path.join(this.dir, name);
      try {
        const stat = fs.statSync(target);
        if (stat.isFile() && stat.mtimeMs < cutoff) fs.unlinkSync(target);
      } catch {
        /* ignore unreadable entries */
      }
    }
  }

  rotate(source) {
    const base = this.file(source);
    for (let index = BACKUPS - 1; index >= 1; index -= 1) {
      const from = `${base}.${index}`;
      const to = `${base}.${index + 1}`;
      try {
        if (fs.existsSync(from)) fs.renameSync(from, to);
      } catch {
        /* keep going: a locked backup must not break logging */
      }
    }
    try {
      if (fs.existsSync(base)) fs.renameSync(base, `${base}.1`);
    } catch {
      /* ignore */
    }
    this.sizes.set(source, 0);
  }

  push(source, chunk) {
    if (!chunk) return;
    const text = String(chunk);
    const buffer = this.ensure(source);
    const incoming = text.split(/\r?\n/).filter((line) => line.length > 0);
    if (incoming.length === 0) return;
    buffer.lines.push(...incoming);
    buffer.cursor += incoming.length;
    if (buffer.lines.length > MAX_LINES) {
      buffer.lines.splice(0, buffer.lines.length - MAX_LINES);
    }
    const payload = incoming.join("\n") + "\n";
    try {
      fs.appendFileSync(this.file(source), payload);
    } catch {
      /* disk full / permission: keep the in-memory copy alive */
    }
    const size = (this.sizes.get(source) || 0) + Buffer.byteLength(payload);
    this.sizes.set(source, size);
    if (size >= MAX_BYTES) this.rotate(source);
  }

  tail(source, cursor = 0) {
    const buffer = this.ensure(source);
    const lines = buffer.lines;
    const total = buffer.cursor;
    // cursor indexes absolute line numbers; map into the ring buffer window
    const firstAbsolute = total - lines.length;
    if (cursor >= total) return { lines: [], cursor: total, source };
    const start = Math.max(0, cursor - firstAbsolute);
    return {
      lines: lines.slice(start),
      cursor: total,
      source,
      truncated: cursor < firstAbsolute,
    };
  }

  pathFor(source) {
    return path.join(this.dir, `${source}.log`);
  }
}

module.exports = { LogBus };
