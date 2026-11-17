import { useEffect, useState } from "react";
import type { ServiceStatus, TaskRow } from "../types";
import { STATUS_CLASS, STATUS_LABEL, duration, shortId } from "../lib/format";

interface Props {
  status: ServiceStatus | null;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  busy: boolean;
}

export default function OverviewPage({ status, onStart, onStop, onRestart, busy }: Props) {
  const [recent, setRecent] = useState<TaskRow[]>([]);
  const running = status?.state === "running";

  useEffect(() => {
    if (!running) {
      setRecent([]);
      return;
    }
    let alive = true;
    const pull = async () => {
      const response = await window.api.listTasks(20);
      if (alive && response.ok && response.data) setRecent(response.data.tasks);
    };
    void pull();
    const timer = window.setInterval(() => void pull(), 3000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [running]);

  const busyTask =
    recent.find((task) => task.status === "running") ??
    recent.find((task) => task.status === "pending") ??
    null;
  const today = recent.filter((task) => (task.submitted_at ?? "").slice(0, 10) === new Date().toISOString().slice(0, 10));

  const state = status?.state ?? "stopped";

  return (
    <div className="page">
      <section className="card">
        <div className="card-head tight">
          <span className="muted">服务</span>
          <span className={`pill ${state}`}>{stateLabel(state)}</span>
        </div>

        <div className="card-body">
          <div className="metric-row">
            <div className="metric-block">
              <span className="metric-caption">队列</span>
              <span className="metric-big">{status?.queueDepth ?? 0}</span>
            </div>
            <div className="metric-block">
              <span className="metric-caption accent">在线 Worker</span>
              <span className="metric-big">{status?.workers ?? 0}</span>
            </div>
            <div className="metric-block">
              <span className="metric-caption">运行</span>
              <span className="metric-big small-num">{duration(status?.uptimeMs ?? 0)}</span>
            </div>
          </div>

          <div className="metric-foot">
            <span>今日任务 {today.length}</span>
            <span>模式 {status?.mode === "external" ? "复用" : status?.mode === "owned" ? "托管" : "—"}</span>
            <span>{status?.baseUrl ?? "http://127.0.0.1:8000"}</span>
          </div>

          {status?.state === "error" && status.lastError && (
            <div className="banner error">{status.lastError}</div>
          )}

          <div className="btn-row">
            {running ? (
              <>
                <button className="btn secondary" disabled={busy} onClick={onRestart}>
                  重启
                </button>
                <button className="btn danger" disabled={busy} onClick={onStop}>
                  停止服务
                </button>
              </>
            ) : (
              <button className="btn primary" disabled={busy} onClick={onStart}>
                {busy ? "启动中…" : "启动服务"}
              </button>
            )}
          </div>
        </div>
      </section>

      <div className="section-label">当前最繁忙</div>
      <section className="card">
        {busyTask ? (
          <div className="card-body">
            <div className="row-between">
              <span className="title-m">{busyTask.args?.join(" ") || "（无参数）"}</span>
              <span className={`badge ${STATUS_CLASS[busyTask.status] ?? ""}`}>
                {STATUS_LABEL[busyTask.status] ?? busyTask.status}
              </span>
            </div>
            <div className="muted small mono">
              {shortId(busyTask.task_id)} · {busyTask.owner ?? busyTask.source ?? "—"} · {busyTask.client_ip ?? ""}
            </div>
          </div>
        ) : (
          <div className="card-body">
            <span className="muted">当前没有正在执行的任务。</span>
          </div>
        )}
      </section>

      <div className="grid-2">
        <section className="card">
          <div className="card-body mini">
            <span className="metric-caption">身份</span>
            <span className="title-m">{status?.health?.identity?.label ?? "—"}</span>
            <span className="muted small mono ellipsis">
              {status?.health?.identity?.workspace ?? status?.cwd ?? "—"}
            </span>
          </div>
        </section>
        <section className="card">
          <div className="card-body mini">
            <span className="metric-caption">局域网</span>
            <span className="title-m">{status?.health?.lan_enabled ? "已开启" : "仅本机"}</span>
            <span className="muted small mono ellipsis">
              {status?.health?.lan_enabled
                ? status?.health?.lan_urls?.[0] ?? status?.baseUrl
                : status?.baseUrl ?? "—"}
            </span>
          </div>
        </section>
      </div>

      <div className="section-label">最近任务</div>
      <section className="card list-card">
        {recent.length === 0 && (
          <div className="list-row">
            <span className="muted">{running ? "还没有任务" : "服务未启动"}</span>
          </div>
        )}
        {recent.slice(0, 6).map((task) => (
          <div className="list-row" key={task.task_id}>
            <div className="list-main">
              <span className="mono small">{task.args?.join(" ") || "（无参数）"}</span>
              <span className="muted small">
                {shortId(task.task_id)} · {task.owner ?? task.source ?? "—"}
              </span>
            </div>
            <div className="list-side">
              <span className={`badge ${STATUS_CLASS[task.status] ?? ""}`}>
                {STATUS_LABEL[task.status] ?? task.status}
              </span>
              <span className="muted small mono">{duration(task.duration_ms)}</span>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

function stateLabel(state: string): string {
  return (
    {
      stopped: "未启动",
      starting: "启动中",
      running: "就绪",
      stopping: "停止中",
      error: "异常",
    }[state] ?? state
  );
}
