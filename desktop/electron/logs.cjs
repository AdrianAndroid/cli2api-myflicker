"use strict";

const fs = require("node:fs");
const path = require("node:path");

const MAX_LINES = 3000;

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
  }

  ensure(source) {
    if (!this.buffers.has(source)) this.buffers.set(source, { lines: [], cursor: 0 });
    return this.buffers.get(source);
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
    try {
      fs.appendFileSync(path.join(this.dir, `${source}.log`), incoming.join("\n") + "\n");
    } catch {
      /* disk full / permission: keep the in-memory copy alive */
    }
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
