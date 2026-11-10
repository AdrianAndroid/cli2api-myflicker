import { useCallback, useEffect, useRef, useState } from "react";
import type { ServiceStatus, TaskResult, TaskRow } from "../types";
import { STATUS_CLASS, STATUS_LABEL, clock, duration, shortId } from "../lib/format";

interface Props {
  status: ServiceStatus | null;
}

export default function TasksPage({ status }: Props) {
  const [args, setArgs] = useState<string[]>([]);
  const [argInput, setArgInput] = useState("");
  const [timeoutValue, setTimeoutValue] = useState("");
  const [cwd, setCwd] = useState("");
  const [envText, setEnvText] = useState("");
  const [rows, setRows] = useState<TaskRow[]>([]);
  const [queueDepth, setQueueDepth] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<TaskResult | null>(null);
  const [detailTab, setDetailTab] = useState<"stdout" | "stderr" | "events" | "cmd">("stdout");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selected;
  const submitRef = useRef<() => Promise<void>>(async () => {});

  const running = status?.state === "running";

  const refresh = useCallback(async () => {
    const response = await window.api.listTasks(40);
    if (response.ok && response.data) {
      setRows(response.data.tasks);
      setQueueDepth(response.data.queue_depth);
      const current = selectedRef.current;
      if (current) {
        const result = await window.api.result(current, true);
        if (result.ok && result.data) setDetail(result.data);
      }
    }
  }, []);

  useEffect(() => {
    if (!running) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(timer);
  }, [running, refresh]);

  const commitArg = (raw?: string) => {
    const value = (raw ?? argInput).trim();
    if (!value) return;
    setArgs((prev) => [...prev, value]);
    setArgInput("");
  };

  const submit = async () => {
    setError(null);
    setNotice(null);
    const finalArgs = argInput.trim() ? [...args, argInput.trim()] : args;
    if (finalArgs.length === 0) {
      setError("至少需要一个参数，例如 list --verbose");
      return;
    }
    const env: Record<string, string> = {};
    for (const line of envText.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.includes("=")) continue;
      const index = trimmed.indexOf("=");
      env[trimmed.slice(0, index)] = trimmed.slice(index + 1);
    }
    const payload: Record<string, unknown> = { args: finalArgs, source: "desktop" };
    if (timeoutValue.trim()) payload.timeout = Number(timeoutValue);
    if (cwd.trim()) payload.cwd = cwd.trim();
    if (Object.keys(env).length) payload.env = env;

    setSubmitting(true);
    try {
      const response = await window.api.submit(payload);
      if (!response.ok || !response.data) {
        const message = (response.data as any)?.error?.message ?? response.error ?? `HTTP ${response.status}`;
        setError(`提交失败：${message}`);
        return;
      }
      setArgs([]);
      setArgInput("");
      setNotice(`已提交 ${shortId(response.data.task_id)} · ${STATUS_LABEL.pending}`);
      setSelected(response.data.task_id);
      await refresh();
    } finally {
      setSubmitting(false);
    }
  };

  submitRef.current = submit;

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void submitRef.current();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const cancel = async (taskId: string) => {
    const response = await window.api.cancel(taskId);
    if (!response.ok) {
      setError(`取消失败：${(response.data as any)?.error?.message ?? response.error}`);
    }
    await refresh();
  };

  return (
    <div className="page">
      <section className="card">
        <header className="card-head">
          <h2>提交任务</h2>
          <span className="muted small">myflicker 串行执行，多个任务会排队</span>
        </header>

        <div className="card-body">
          <div className="chips">
            {args.map((item, index) => (
              <span className="chip" key={`${item}-${index}`}>
                {item}
                <button className="chip-x" onClick={() => setArgs(args.filter((_, i) => i !== index))}>
                  ×
                </button>
              </span>
            ))}
            <input
              className="chip-input"
              placeholder={args.length ? "继续添加参数…" : "list --verbose"}
              value={argInput}
              onChange={(event) => setArgInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  if (argInput.trim()) {
                    event.preventDefault();
                    commitArg();
                  }
                } else if (event.key === "Backspace" && !argInput && args.length) {
                  setArgs(args.slice(0, -1));
                } else if (event.key === "Enter" && !argInput.trim()) {
                  void submit();
                }
              }}
            />
          </div>

          <div className="grid-3">
            <label className="field">
              <span>超时 (秒)</span>
              <input
                className="input"
                placeholder={String(status?.health?.default_timeout ?? 300)}
                value={timeoutValue}
                onChange={(event) => setTimeoutValue(event.target.value)}
              />
            </label>
            <label className="field">
              <span>cwd</span>
              <div className="row-flex">
                <input
                  className="input"
                  placeholder={status?.cwd || "默认工作目录"}
                  value={cwd}
                  onChange={(event) => setCwd(event.target.value)}
                />
                <button
                  className="btn small ghost"
                  onClick={async () => {
                    const dir = await window.api.pickDir();
                    if (dir) setCwd(dir);
                  }}
                >
                  选择
                </button>
              </div>
            </label>
            <label className="field">
              <span>env (K=V 每行一个)</span>
              <input
                className="input"
                placeholder="MYFLICKER_TOKEN=…"
                value={envText}
                onChange={(event) => setEnvText(event.target.value)}
              />
            </label>
          </div>

          <div className="form-foot">
            <div className="muted small">
              队列 {queueDepth ?? status?.queueDepth ?? 0}
              {status?.health?.max_queue_depth ? ` / 上限 ${status.health.max_queue_depth}` : ""}
              {!running && " · 服务未启动"}
              {" · 交互式命令需加 -q，否则会挂到超时"}
            </div>
            <div className="row-flex">
              {error && <span className="text-error small">{error}</span>}
              {notice && <span className="text-ok small">{notice}</span>}
              <button className="btn primary" disabled={submitting || !running} onClick={submit}>
                {submitting ? "提交中…" : "提交任务 ⌘⏎"}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <header className="card-head">
          <h2>任务列表</h2>
          <div className="row-flex">
            <span className="muted small">每 2s 刷新</span>
            <button className="btn small ghost" onClick={() => void refresh()}>
              刷新
            </button>
          </div>
        </header>
        <div className="card-body no-pad">
          <table className="table">
            <thead>
              <tr>
                <th>task_id</th>
                <th>来源</th>
                <th>状态</th>
                <th>耗时</th>
                <th>rc</th>
                <th>提交时间</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty">
                    {running ? "还没有任务" : "服务未启动"}
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr
                  key={row.task_id}
                  className={selected === row.task_id ? "selected" : ""}
                  onClick={() => {
                    setSelected(row.task_id);
                    setDetail(null);
                    void window.api.result(row.task_id, true).then((res) => {
                      if (res.ok) setDetail(res.data);
                    });
                  }}
                >
                  <td className="mono">{shortId(row.task_id)}</td>
                  <td className="mono small">{row.source || "—"}</td>
                  <td>
                    <span className={`badge ${STATUS_CLASS[row.status] || ""}`}>
                      {STATUS_LABEL[row.status] || row.status}
                    </span>
                    {row.timed_out && <span className="badge st-failure ml6">超时</span>}
                  </td>
                  <td className="mono">{duration(row.duration_ms)}</td>
                  <td className="mono">{row.returncode ?? "—"}</td>
                  <td className="mono small">{clock(row.submitted_at)}</td>
                  <td>
                    {row.status === "pending" && (
                      <button
                        className="btn small ghost"
                        onClick={(event) => {
                          event.stopPropagation();
                          void cancel(row.task_id);
                        }}
                      >
                        取消
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <header className="card-head">
          <h2>结果</h2>
          <div className="row-flex">
            {detail && (
              <span className="muted small mono">
                {shortId(detail.task_id)} · {STATUS_LABEL[detail.status] || detail.status} · rc={detail.returncode ?? "—"} ·{" "}
                {duration(detail.duration_ms)}
              </span>
            )}
            {detail && (
              <button className="btn small ghost" onClick={() => navigator.clipboard.writeText(detail.task_id)}>
                复制 task_id
              </button>
            )}
          </div>
        </header>
        <div className="card-body">
          {!detail && <div className="muted small">选择上方任意任务查看 stdout / stderr / 事件链</div>}
          {detail && (
            <>
              {detail.error && <div className="banner inline error">{detail.error}</div>}
              <div className="tabs small-tabs">
                {(["stdout", "stderr", "events", "cmd"] as const).map((key) => (
                  <button
                    key={key}
                    className={`tab ${detailTab === key ? "active" : ""}`}
                    onClick={() => setDetailTab(key)}
                  >
                    {key}
                    {key === "stderr" && detail.stderr ? ` (${detail.stderr.length})` : ""}
                  </button>
                ))}
              </div>
              <pre className="pre">
                {detailTab === "stdout" && (detail.stdout || "（空）")}
                {detailTab === "stderr" && (detail.stderr || "（空）")}
                {detailTab === "cmd" && (detail.cmdline || "（空）")}
                {detailTab === "events" &&
                  (detail.events && detail.events.length
                    ? detail.events.map((event) => JSON.stringify(event)).join("\n")
                    : "（暂无事件）")}
              </pre>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
