import { useEffect, useRef, useState } from "react";
import type { ServiceStatus } from "./types";
import TasksPage from "./views/TasksPage";
import ChatPage from "./views/ChatPage";
import LogsPage from "./views/LogsPage";
import SettingsPage from "./views/SettingsPage";
import OverviewPage from "./views/OverviewPage";
import ConnectPage from "./views/ConnectPage";

type Tab = "overview" | "tasks" | "chat" | "logs" | "settings" | "connect";
type Role = "provider" | "client";

const TABS: Array<{ key: Tab; label: string; icon: string; service?: boolean }> = [
  { key: "overview", label: "服务", service: true, icon: "M3 13h4v8H3zM10 3h4v18h-4zM17 9h4v12h-4z" },
  { key: "tasks", label: "任务", service: true, icon: "M4 6h16M4 12h16M4 18h10" },
  { key: "chat", label: "工作区", icon: "M4 5h16v10H8l-4 4z" },
  { key: "logs", label: "日志", service: true, icon: "M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" },
  {
    key: "connect",
    label: "连接",
    icon: "M9 17H7a5 5 0 0 1 0-10h2M15 7h2a5 5 0 0 1 0 10h-2M8 12h8",
  },
  {
    key: "settings",
    label: "设置",
    service: true,
    icon: "M12 8.4a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2zM12 3l1.3 2.2 2.5-.4 1 2.3 2.2 1.2-.4 2.5L20.8 12l-2.2 1.2.4 2.5-2.2 1.2-1 2.3-2.5-.4L12 21l-1.3-2.2-2.5.4-1-2.3-2.2-1.2.4-2.5L3.2 12l2.2-1.2-.4-2.5 2.2-1.2 1-2.3 2.5.4z",
  },
];

const TITLES: Record<Tab, string> = {
  overview: "服务总览",
  tasks: "任务",
  chat: "工作区",
  logs: "日志",
  connect: "连接与档案",
  settings: "设置",
};

function tabsFor(serviceVisible: boolean) {
  return TABS.filter((tab) => !tab.service || serviceVisible);
}

function initialTab(serviceVisible: boolean): Tab {
  const requested = new URLSearchParams(window.location.search).get("tab") as Tab | null;
  const allowed = tabsFor(serviceVisible);
  if (requested && allowed.some((tab) => tab.key === requested)) return requested;
  return serviceVisible ? "overview" : "chat";
}

export default function App() {
  const [tab, setTab] = useState<Tab>(() => initialTab(true));
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

  const role: Role = status?.role ?? "provider";
  const profileKind = status?.profile?.kind ?? "local";
  const serviceVisible = role === "provider" && profileKind === "local";
  const connected = serviceVisible ? status?.state === "running" : Boolean(status?.connected);
  const tabs = tabsFor(serviceVisible);
  const activeTab: Tab = tabs.some((item) => item.key === tab) ? tab : tabs[0].key;
  // a saved profile that is temporarily unreachable stays on the workspace
  // (history is readable, input disabled) instead of bouncing to the form
  const savedProfile = Boolean(status?.profile?.hasKey);
  const pendingConnect = role === "client" && !connected && !savedProfile;
  const shownTab: Tab = pendingConnect ? "connect" : activeTab;
  const offline = !connected && savedProfile && (role === "client" || profileKind === "remote");

  useEffect(() => {
    if (!tabs.some((item) => item.key === tab)) setTab(tabs[0].key);
  }, [role, profileKind]);

  // switching between local and remote profiles lands on that role's home screen
  // (skipped on the first render so `?tab=` deep links survive)
  const firstVisibility = useRef(true);
  useEffect(() => {
    if (firstVisibility.current) {
      firstVisibility.current = false;
      return;
    }
    setTab(serviceVisible ? "overview" : "chat");
  }, [serviceVisible]);

  const run = async (action: "start" | "stop" | "restart") => {
    setBusy(true);
    try {
      const next = await window.api[action]();
      setStatus(next);
    } finally {
      setBusy(false);
    }
  };

  const pickRole = async (next: Role) => {
    setBusy(true);
    try {
      setStatus(await window.api.setRole(next));
    } finally {
      setBusy(false);
    }
  };

  const state = status?.state ?? "stopped";
  const live = state === "running" || state === "starting";

  if (status && status.onboarded === false) {
    return (
      <div className="shell">
        <header className="page-head">
          <h1>这台电脑用来做什么？</h1>
          <div className="subline">
            <span>首次启动选择一次，之后可在「连接」页随时切换</span>
          </div>
        </header>
        <main className={`screen ${shownTab === "chat" ? "no-scroll" : ""}`}>
          <div className="page">
            <section className="card">
              <div className="card-body">
                <h2>提供服务</h2>
                <p className="muted small">
                  把本机 myflicker 变成 API：需要 Python 依赖与 Redis，会占用本机资源。
                </p>
                <button className="btn primary" disabled={busy} onClick={() => void pickRole("provider")}>
                  用这台电脑提供服务
                </button>
              </div>
            </section>
            <section className="card">
              <div className="card-body">
                <h2>连接使用</h2>
                <p className="muted small">
                  连已经开好的 API：只需要地址 + Key，不需要本地依赖。
                </p>
                <button className="btn secondary" disabled={busy} onClick={() => void pickRole("client")}>
                  连接已有的 API
                </button>
              </div>
            </section>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="shell app-shell">
      <aside className="rail">
        <div className="rail-top">
          <span
            className={`dot ${connected ? "ok" : state === "error" ? "bad" : "idle"}`}
            title={connected ? "已连接" : serviceVisible ? stateLabel(state) : "未连接"}
          />
        </div>

        <nav className="rail-nav">
          {tabs.map((item) => (
            <button
              key={item.key}
              className={`rail-item ${shownTab === item.key ? "active" : ""}`}
              title={item.label}
              aria-label={item.label}
              onClick={() => setTab(item.key)}
            >
              <svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true">
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

        <div className="rail-foot" title={role === "provider" ? "服务机" : "使用机"}>
          {role === "provider" ? "服务" : "使用"}
        </div>
      </aside>

      <div className={`main ${shownTab === "chat" ? "wide" : ""}`}>
        <header className="page-head">
          <h1>{pendingConnect ? "连接 API 服务" : TITLES[shownTab]}</h1>
          <div className="subline">
            <span className={`dot ${connected ? "ok" : state === "error" ? "bad" : "idle"}`} />
            <span>{status?.profile?.name ?? status?.health?.identity?.label ?? "local"}</span>
            <span className="dot-sep">·</span>
            <span>{connected ? "已连接" : serviceVisible ? stateLabel(state) : "未连接"}</span>
            {serviceVisible && live && <span className="mono">· 队列 {status?.queueDepth ?? 0}</span>}
          </div>
        </header>

        <main className={`screen ${shownTab === "chat" ? "no-scroll" : ""}`}>
          {shownTab === "connect" && <ConnectPage status={status} onConnected={setStatus} />}
          {shownTab === "overview" && (
            <OverviewPage
              status={status}
              busy={busy}
              onStart={() => void run("start")}
              onStop={() => void run("stop")}
              onRestart={() => void run("restart")}
            />
          )}
          {shownTab === "tasks" && <TasksPage status={status} />}
          {/* chat stays mounted so switching pages (or an in-flight stream) does not lose state */}
          {(role === "provider" || connected || savedProfile) && (
            <div className={shownTab === "chat" ? "tab-pane" : "tab-pane hidden"}>
              <ChatPage status={status} offline={offline} />
            </div>
          )}
          {shownTab === "logs" && <LogsPage status={status} />}
          {shownTab === "settings" && <SettingsPage status={status} />}
        </main>
      </div>
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
