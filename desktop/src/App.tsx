import { useEffect, useState } from "react";
import type { ServiceStatus } from "./types";
import { duration } from "./lib/format";
import TasksPage from "./views/TasksPage";
import ChatPage from "./views/ChatPage";
import LogsPage from "./views/LogsPage";
import LanPage from "./views/LanPage";
import SettingsPage from "./views/SettingsPage";

type Tab = "tasks" | "chat" | "logs" | "lan" | "settings";

const TABS: Array<{ key: Tab; label: string; hint: string }> = [
  { key: "tasks", label: "任务", hint: "提交 / 排队 / 结果" },
  { key: "chat", label: "聊天", hint: "对话式测试" },
  { key: "logs", label: "日志", hint: "worker / api 实时流" },
  { key: "lan", label: "局域网", hint: "访问控制与地址" },
  { key: "settings", label: "设置", hint: ".env 配置" },
];

function initialTab(): Tab {
  const requested = new URLSearchParams(window.location.search).get("tab");
  return (TABS.find((tab) => tab.key === requested)?.key ?? "tasks") as Tab;
}

export default function App() {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [installing, setInstalling] = useState(false);
  const reload = () => window.api.getStatus().then(setStatus);

  useEffect(() => {
    let alive = true;
    const load = () => {
      window.api
        .getStatus()
        .then((next) => {
          if (alive) setStatus(next);
        })
        .catch(() => {
          /* gateway down: keep the last known snapshot */
        });
    };
    load();
    const off = window.api.onStatus(setStatus);
    const timer = window.setInterval(load, 2000);
    return () => {
      alive = false;
      off();
      window.clearInterval(timer);
    };
  }, []);

  const initEnv = async () => {
    setInstalling(true);
    try {
      const info = await window.api.setupInit();
      setStatus((prev) => (prev ? { ...prev, setup: info } : prev));
      await reload();
    } catch {
      await reload();
    } finally {
      setInstalling(false);
    }
  };

  const run = async (action: "start" | "stop" | "restart") => {
    setBusy(true);
    try {
      const next = await window.api[action]();
      setStatus(next);
    } finally {
      setBusy(false);
    }
  };

  const state = status?.state ?? "stopped";
  const redisOk = Boolean(status?.health?.redis?.ok) || state === "running";
  const workerOk = (status?.workers ?? 0) > 0;
  const apiOk = state === "running";

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" />
          <div>
            <div className="brand-title">myflicker</div>
            <div className="brand-sub">local gateway</div>
          </div>
        </div>
        <nav>
          {TABS.map((item) => (
            <button
              key={item.key}
              className={`nav-item ${tab === item.key ? "active" : ""}`}
              onClick={() => setTab(item.key)}
            >
              <span className="nav-label">{item.label}</span>
              <span className="nav-hint">{item.hint}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className={`pill ${state}`}>{stateLabel(state)}</div>
          <div className="muted small">{status?.baseUrl ?? "http://127.0.0.1:8000"}</div>
          <div className="muted small">{status?.bin || "MYFLICKER_BIN 未配置"}</div>
        </div>
      </aside>

      <main className="main">
        <header className="statusbar">
          <div className="dots">
            <Dot ok={redisOk} label={`Redis :${status?.redis?.port ?? 6379}`} />
            <Dot ok={workerOk} idle={state !== "running"} label={`Worker ${workerOk ? `×${status?.workers}` : "off"}`} />
            <Dot ok={apiOk} label={`API :${status?.port ?? 8000}`} />
          </div>

          <div className="metrics">
            <Metric label="队列" value={String(status?.queueDepth ?? 0)} />
            <Metric label="运行" value={duration(status?.uptimeMs ?? 0)} />
            <Metric label="模式" value={status?.mode === "external" ? "复用" : status?.mode === "owned" ? "托管" : "—"} />
          </div>

          <div className="actions">
            {state === "running" || state === "starting" ? (
              <>
                <button className="btn ghost" disabled={busy} onClick={() => run("restart")}>
                  重启
                </button>
                <button className="btn danger" disabled={busy} onClick={() => run("stop")}>
                  停止
                </button>
              </>
            ) : (
              <button className="btn primary" disabled={busy} onClick={() => run("start")}>
                {busy ? "启动中…" : "启动服务"}
              </button>
            )}
          </div>
        </header>

        {status?.setup && !status.setup.ready && !installing && (
          <div className="banner warn setup-banner">
            <strong>运行环境未就绪</strong>
            <span>{status.setup.error || "需要安装 Python 依赖后才能启动服务"}</span>
            <code className="mono small ellipsis">{status.setup.python}</code>
            <button className="btn small primary" disabled={busy} onClick={() => void initEnv()}>
              初始化运行环境
            </button>
            <button className="btn small ghost" onClick={() => setTab("logs")}>
              查看 setup 日志
            </button>
          </div>
        )}

        {installing && (
          <div className="banner warn setup-banner">
            <strong>正在初始化运行环境</strong>
            <span>创建 venv 并安装依赖，可能需要 1–3 分钟，请勿关闭窗口</span>
            <button className="btn small ghost" onClick={() => setTab("logs")}>
              查看进度
            </button>
          </div>
        )}

        {status?.state === "error" && status.lastError && (
          <div className="banner error">
            <strong>服务异常</strong>
            <span>{status.lastError}</span>
            <button className="btn small ghost" onClick={() => setTab("logs")}>
              查看日志
            </button>
          </div>
        )}

        <div className="content">
          {tab === "tasks" && <TasksPage status={status} />}
          {tab === "chat" && <ChatPage status={status} />}
          {tab === "logs" && <LogsPage status={status} />}
          {tab === "lan" && <LanPage status={status} />}
          {tab === "settings" && <SettingsPage status={status} />}
        </div>
      </main>
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

function Dot({ ok, idle, label }: { ok: boolean; idle?: boolean; label: string }) {
  const cls = idle ? "idle" : ok ? "ok" : "bad";
  return (
    <span className="dot-wrap">
      <span className={`dot ${cls}`} />
      <span className="dot-label">{label}</span>
    </span>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <span className="metric">
      <span className="metric-label">{label}</span>
      <span className="metric-value">{value}</span>
    </span>
  );
}
