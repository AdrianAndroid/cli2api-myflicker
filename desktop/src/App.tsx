import { useEffect, useState } from "react";
import type { ServiceStatus } from "./types";
import TasksPage from "./views/TasksPage";
import ChatPage from "./views/ChatPage";
import LogsPage from "./views/LogsPage";
import SettingsPage from "./views/SettingsPage";
import OverviewPage from "./views/OverviewPage";

type Tab = "overview" | "tasks" | "chat" | "logs" | "settings";

const TABS: Array<{ key: Tab; label: string; icon: string }> = [
  { key: "overview", label: "总览", icon: "M3 13h4v8H3zM10 3h4v18h-4zM17 9h4v12h-4z" },
  { key: "tasks", label: "任务", icon: "M4 6h16M4 12h16M4 18h10" },
  { key: "chat", label: "聊天", icon: "M4 5h16v10H8l-4 4z" },
  { key: "logs", label: "日志", icon: "M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" },
  {
    key: "settings",
    label: "设置",
    icon: "M12 8.4a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2zM12 3l1.3 2.2 2.5-.4 1 2.3 2.2 1.2-.4 2.5L20.8 12l-2.2 1.2.4 2.5-2.2 1.2-1 2.3-2.5-.4L12 21l-1.3-2.2-2.5.4-1-2.3-2.2-1.2.4-2.5L3.2 12l2.2-1.2-.4-2.5 2.2-1.2 1-2.3 2.5.4z",
  },
];

const TITLES: Record<Tab, string> = {
  overview: "总览",
  tasks: "任务",
  chat: "聊天",
  logs: "日志",
  settings: "设置",
};

function initialTab(): Tab {
  const requested = new URLSearchParams(window.location.search).get("tab") as Tab | null;
  return TABS.some((tab) => tab.key === requested) ? (requested as Tab) : "overview";
}

export default function App() {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () => {
      window.api
        .getStatus()
        .then((next) => {
          if (alive) setStatus(next);
        })
        .catch(() => {
          /* keep the last snapshot */
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
  const live = state === "running" || state === "starting";

  return (
    <div className="shell">
      <header className="page-head">
        <h1>{TITLES[tab]}</h1>
        <div className="subline">
          <span className={`dot ${state === "running" ? "ok" : state === "error" ? "bad" : "idle"}`} />
          <span>{status?.health?.identity?.label ?? "local"}</span>
          <span className="dot-sep">·</span>
          <span>{stateLabel(state)}</span>
          {live && <span className="mono">· 队列 {status?.queueDepth ?? 0}</span>}
        </div>
      </header>

      <main className="screen">
        {tab === "overview" && (
          <OverviewPage
            status={status}
            busy={busy}
            onStart={() => void run("start")}
            onStop={() => void run("stop")}
            onRestart={() => void run("restart")}
          />
        )}
        {tab === "tasks" && <TasksPage status={status} />}
        {/* chat stays mounted so switching tabs (or an in-flight stream) does not lose state */}
        <div className={tab === "chat" ? "tab-pane" : "tab-pane hidden"}>
          <ChatPage status={status} />
        </div>
        {tab === "logs" && <LogsPage status={status} />}
        {tab === "settings" && <SettingsPage status={status} />}
      </main>

      <footer className="dock">
        <button
          className="server-pill"
          disabled={busy}
          onClick={() => void run(live ? "stop" : "start")}
        >
          <span className="server-icon">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                d="M4 7h16v4H4zM4 13h16v4H4z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="server-text">
            <span className="server-name">myflicker · {stateLabel(state)}</span>
            <span className="server-meta">
              队列 {status?.queueDepth ?? 0} · worker {status?.workers ?? 0} ·{" "}
              {busy ? "处理中…" : live ? "点击停止" : "点击启动"}
            </span>
          </span>
          <span className="chevron">{live ? "停止" : "启动"}</span>
        </button>

        <nav className="tabbar">
          {TABS.map((item) => (
            <button
              key={item.key}
              className={`tab-item ${tab === item.key ? "active" : ""}`}
              onClick={() => setTab(item.key)}
            >
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                <path
                  d={item.icon}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      </footer>
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
