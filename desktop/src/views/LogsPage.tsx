import { useEffect, useMemo, useRef, useState } from "react";
import type { ServiceStatus } from "../types";

interface Props {
  status: ServiceStatus | null;
}

const SOURCES = [
  { key: "worker", label: "worker.log" },
  { key: "api", label: "api.log" },
  { key: "redis", label: "redis.log" },
  { key: "setup", label: "setup.log" },
] as const;

type Source = (typeof SOURCES)[number]["key"];

export default function LogsPage({ status }: Props) {
  const [source, setSource] = useState<Source>("worker");
  const [lines, setLines] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [paused, setPaused] = useState(false);
  const cursorRef = useRef(0);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    cursorRef.current = 0;
    setLines([]);
  }, [source]);

  useEffect(() => {
    if (paused) return;
    let alive = true;
    const pull = async () => {
      const response = await window.api.tailLogs(source, cursorRef.current);
      if (!alive || !response.lines.length) return;
      cursorRef.current = response.cursor;
      setLines((prev) => [...prev, ...response.lines].slice(-2000));
    };
    void pull();
    const timer = window.setInterval(() => void pull(), 1000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [source, paused]);

  useEffect(() => {
    if (!paused) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [lines.length, paused]);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return lines;
    return lines.filter((line) => line.toLowerCase().includes(needle));
  }, [lines, filter]);

  return (
    <div className="page">
      <section className="card">
        <header className="card-head">
          <h2>服务日志</h2>
          <div className="row-flex">
            {SOURCES.map((item) => (
              <button
                key={item.key}
                className={`tab ${source === item.key ? "active" : ""}`}
                onClick={() => setSource(item.key)}
              >
                {item.label}
              </button>
            ))}
            <button className="btn small ghost" onClick={() => setPaused(!paused)}>
              {paused ? "继续" : "暂停"}
            </button>
            <button className="btn small ghost" onClick={() => window.api.openLog(source)}>
              打开文件
            </button>
          </div>
        </header>

        <div className="card-body">
          <div className="row-flex log-toolbar">
            <input
              className="input"
              placeholder="过滤关键字，例如 ERROR / task.finished"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
            <span className="muted small">
              {visible.length}/{lines.length} 行 · {paused ? "已暂停" : "实时"}
            </span>
          </div>
          <div className="logview">
            {visible.length === 0 && <div className="muted small">暂无输出（服务未启动时为空）</div>}
            {visible.map((line, index) => (
              <div
                key={`${index}-${line.slice(0, 24)}`}
                className={`logline ${/ERROR|Traceback|failed/.test(line) ? "bad" : /WARN/.test(line) ? "warn" : ""}`}
              >
                {line}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
          <div className="muted small">
            日志目录：{status?.logDir ? `${status.logDir}/desktop/` : "logs/desktop/"}（任务日志见 {status?.logDir || "logs"}/tasks/）
          </div>
        </div>
      </section>
    </div>
  );
}
