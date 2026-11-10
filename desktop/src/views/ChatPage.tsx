import { useCallback, useEffect, useRef, useState } from "react";
import type { ServiceStatus, TaskResult } from "../types";
import { STATUS_LABEL, duration, shortId, tokenize } from "../lib/format";

interface Props {
  status: ServiceStatus | null;
}

interface Message {
  id: string;
  role: "user" | "agent";
  text: string;
  args?: string[];
  taskId?: string;
  state?: "pending" | "running" | "success" | "failure" | "canceled" | "error";
  elapsedMs?: number;
  result?: TaskResult;
  error?: string;
  expand?: boolean;
  quiet?: boolean;
}

const uid = () => Math.random().toString(36).slice(2);

const quoteArg = (arg: string) => (/\s/.test(arg) ? JSON.stringify(arg) : arg);

/** myflicker is an interactive agent CLI: -q/--quiet is what makes it one-shot. */
function buildPromptArgs(prompt: string, cont: boolean): string[] {
  const args = ["-q"];
  if (cont) args.push("-c");
  args.push(prompt);
  return args;
}

export default function ChatPage({ status }: Props) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: uid(),
      role: "agent",
      text: "输入 myflicker 参数即可执行（例如 list --verbose）。支持 /timeout 600、/cwd /path、/env K=V、/clear。",
    },
  ]);
  const [input, setInput] = useState("");
  const [sessionTimeout, setSessionTimeout] = useState<string>("600");
  const [sessionCwd, setSessionCwd] = useState<string>("");
  const [sessionEnv, setSessionEnv] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<"prompt" | "args">(
    (localStorage.getItem("myflicker.chat.mode") as "prompt" | "args") || "prompt",
  );
  const [cont, setCont] = useState<boolean>(localStorage.getItem("myflicker.chat.cont") === "1");
  const running = status?.state === "running";
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const patch = useCallback((id: string, next: Partial<Message>) => {
    setMessages((prev) => prev.map((item) => (item.id === id ? { ...item, ...next } : item)));
  }, []);

  const watch = useCallback(
    async (agentId: string, taskId: string) => {
      const startedAt = Date.now();
      for (let attempt = 0; attempt < 600; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 400 : 1000));
        const response = await window.api.result(taskId, true);
        if (!response.ok) {
          if (response.status === 404) {
            patch(agentId, { state: "error", error: "任务已过期或不存在" });
            return;
          }
          continue;
        }
        const data = response.data as TaskResult;
        const elapsedMs = Date.now() - startedAt;
        if (data.finished) {
          patch(agentId, { state: data.status, result: data, elapsedMs });
          return;
        }
        patch(agentId, { state: data.status === "running" ? "running" : "pending", elapsedMs });
      }
      patch(agentId, { state: "error", error: "轮询超时（客户端放弃等待）" });
    },
    [patch],
  );

  const send = useCallback(async () => {
    const raw = input.trim();
    if (!raw) return;
    setInput("");

    if (raw.startsWith("/")) {
      const [command, ...rest] = raw.split(/\s+/);
      const value = rest.join(" ");
      if (command === "/clear") {
        setMessages([]);
        return;
      }
      if (command === "/timeout") {
        setSessionTimeout(value);
        setMessages((prev) => [...prev, { id: uid(), role: "agent", text: `会话超时设为 ${value || "默认"} 秒` }]);
        return;
      }
      if (command === "/cwd") {
        setSessionCwd(value);
        setMessages((prev) => [...prev, { id: uid(), role: "agent", text: `会话 cwd 设为 ${value || "默认"}` }]);
        return;
      }
      if (command === "/env") {
        const index = value.indexOf("=");
        if (index > 0) {
          const key = value.slice(0, index);
          const val = value.slice(index + 1);
          setSessionEnv((prev) => ({ ...prev, [key]: val }));
          setMessages((prev) => [...prev, { id: uid(), role: "agent", text: `已设置环境变量 ${key}` }]);
          return;
        }
      }
      setMessages((prev) => [
        ...prev,
        { id: uid(), role: "agent", text: "未知指令。支持 /timeout、/cwd、/env K=V、/clear" },
      ]);
      return;
    }

    const args =
      mode === "prompt" ? buildPromptArgs(raw, cont) : tokenize(raw);
    if (args.length === 0) return;
    const userId = uid();
    const agentId = uid();
    setMessages((prev) => [
      ...prev,
      { id: userId, role: "user", text: raw },
      { id: agentId, role: "agent", text: "提交中…", args, state: "pending" },
      { id: uid(), role: "agent", text: `$ myflicker ${args.map(quoteArg).join(" ")}`, quiet: true } as Message,

    ]);

    const payload: Record<string, unknown> = { args, source: "chat" };
    if (sessionTimeout.trim()) payload.timeout = Number(sessionTimeout);
    if (sessionCwd.trim()) payload.cwd = sessionCwd.trim();
    if (Object.keys(sessionEnv).length) payload.env = sessionEnv;

    const response = await window.api.submit(payload);
    if (!response.ok || !response.data) {
      patch(agentId, {
        state: "error",
        error: (response.data as any)?.error?.message ?? response.error ?? `HTTP ${response.status}`,
        text: "提交失败",
      });
      return;
    }
    const taskId = response.data.task_id;
    patch(agentId, { taskId, text: "", state: "pending" });
    void watch(agentId, taskId);
  }, [cont, input, mode, patch, sessionCwd, sessionEnv, sessionTimeout, watch]);

  return (
    <div className="page chat-page">
      <section className="card chat-card">
        <header className="card-head">
          <h2>聊天测试</h2>
          <div className="row-flex">
            <span className="muted small">
              {running ? `${status?.baseUrl} · 队列 ${status?.queueDepth ?? 0} · worker ×${status?.workers ?? 0}` : "服务未启动"}
            </span>
            <button className="btn small ghost" onClick={() => setMessages([])}>
              清空
            </button>
          </div>
        </header>

        <div className="chat-body">
          {messages.map((message) => (
            <MessageRow
              key={message.id}
              message={message}
              onToggle={() =>
                patch(message.id, {
                  expand: !message.expand,
                  result: message.result ?? (message.taskId ? undefined : message.result),
                })
              }
              onCancel={async () => {
                if (message.taskId) await window.api.cancel(message.taskId);
              }}
            />
          ))}
          <div ref={bottomRef} />
        </div>

        <div className="chat-input">
          <div className="row-flex chat-controls">
            <div className="segmented">
              <button
                className={mode === "prompt" ? "active" : ""}
                onClick={() => {
                  setMode("prompt");
                  localStorage.setItem("myflicker.chat.mode", "prompt");
                }}
              >
                对话（自动 -q）
              </button>
              <button
                className={mode === "args" ? "active" : ""}
                onClick={() => {
                  setMode("args");
                  localStorage.setItem("myflicker.chat.mode", "args");
                }}
              >
                参数（原样透传）
              </button>
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={cont}
                onChange={(event) => {
                  setCont(event.target.checked);
                  localStorage.setItem("myflicker.chat.cont", event.target.checked ? "1" : "0");
                }}
              />
              续接上次会话 (-c)
            </label>
            <span className="muted small mono chat-hint">
              /timeout {sessionTimeout || "默认"} · /cwd {sessionCwd || "默认"} · env{" "}
              {Object.keys(sessionEnv).join(",") || "无"}
            </span>
          </div>
          {mode === "args" && !/\s-q\b|--quiet|--help|--version/.test(input) && input.trim() && (
            <div className="text-warn small">
              提示：myflicker 默认是交互模式，缺少 -q 会一直等待输入直到超时。
            </div>
          )}
          <div className="row-flex">
            <input
              className="input"
              placeholder={mode === "prompt" ? "帮我看下这个仓库的目录结构" : "-q --help"}
              value={input}
              disabled={!running}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <button className="btn primary" disabled={!running} onClick={() => void send()}>
              发送
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function MessageRow({
  message,
  onToggle,
  onCancel,
}: {
  message: Message;
  onToggle: () => void;
  onCancel: () => void;
}) {
  if (message.quiet) {
    return <div className="msg agent mono-line">{message.text}</div>;
  }

  if (message.role === "user") {
    return (
      <div className="msg user">
        <div className="bubble">{message.text}</div>
      </div>
    );
  }

  const state = message.state ?? "pending";
  const label = STATUS_LABEL[state] ?? (state === "error" ? "错误" : state);
  const detail = message.result;

  return (
    <div className="msg agent">
      <div className="bubble agent-bubble">
        <div className="bubble-head">
          <span className="mono small">myflicker</span>
          <span className={`badge st-${state}`}>{label}</span>
          {message.elapsedMs !== undefined && state !== "success" && state !== "failure" && (
            <span className="muted small mono">{duration(message.elapsedMs)}</span>
          )}
          {detail && <span className="muted small mono">{duration(detail.duration_ms)}</span>}
          {message.taskId && (
            <span className="muted small mono" title={message.taskId}>
              {shortId(message.taskId)}
            </span>
          )}
          {state === "pending" && message.taskId && (
            <button className="btn small ghost" onClick={onCancel}>
              取消排队
            </button>
          )}
        </div>

        {message.error && <div className="text-error small">{message.error}</div>}
        {state === "running" && <div className="muted small">执行中…</div>}
        {state === "pending" && <div className="muted small">排队中，等待串行 worker 取任务…</div>}

        {detail && (
          <>
            {detail.error && <div className="text-error small">{detail.error}</div>}
            <pre className="pre chat-pre">{detail.stdout || "（无输出）"}</pre>
            {detail.stderr ? (
              <button className="btn small ghost" onClick={onToggle}>
                stderr ({detail.stderr.length}) {message.expand ? "隐藏" : "展开"}
              </button>
            ) : null}
            {message.expand && detail.stderr && <pre className="pre chat-pre error-pre">{detail.stderr}</pre>}
            <div className="row-flex muted small mono">
              <span>rc={detail.returncode ?? "—"}</span>
              {detail.cmdline && <span className="ellipsis">{detail.cmdline}</span>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
