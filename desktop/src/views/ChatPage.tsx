import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatEvent, ServiceStatus } from "../types";

interface Props {
  status: ServiceStatus | null;
}

type Step =
  | { kind: "tool"; id: string; name: string; input: string }
  | { kind: "result"; id: string; text: string };

interface ChatMsg {
  id: string;
  role: "user" | "assistant";
  text: string;
  steps: Step[];
  status: "streaming" | "done" | "error" | "aborted";
  taskId?: string;
  sessionId?: string;
  error?: string;
}

const uid = () => Math.random().toString(36).slice(2, 10);

const STORAGE_KEY = "myflicker.chat.messages.v1";
const MAX_PERSISTED = 60;
const MAX_STORAGE_BYTES = 512 * 1024;

/** Reload the transcript after a restart; dangling streams become "aborted". */
function loadMessages(): ChatMsg[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((msg: ChatMsg) =>
      msg.status === "streaming" ? { ...msg, status: "aborted" as const } : msg,
    );
  } catch {
    return [];
  }
}

export default function ChatPage({ status }: Props) {
  const [messages, setMessages] = useState<ChatMsg[]>(loadMessages);
  const [input, setInput] = useState("");
  const [timeoutSec, setTimeoutSec] = useState("600");
  const [activeRequest, setActiveRequest] = useState<string | null>(null);
  const messagesRef = useRef<ChatMsg[]>([]);
  messagesRef.current = messages;
  const requestMap = useRef<Map<string, string>>(new Map());
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const running = status?.state === "running";

  const patch = useCallback((id: string, update: (msg: ChatMsg) => ChatMsg) => {
    setMessages((prev) => prev.map((msg) => (msg.id === id ? update(msg) : msg)));
  }, []);

  const applyAgentEvent = useCallback(
    (msgId: string, event: any) => {
      const type = event?.type;
      if (type === "system" && event?.subtype === "init") {
        patch(msgId, (msg) => ({ ...msg, sessionId: event.sessionId ?? msg.sessionId }));
        return;
      }
      if (type === "message" && event?.role === "assistant" && Array.isArray(event.content)) {
        for (const block of event.content) {
          if (block?.type === "tool_use") {
            patch(msgId, (msg) => ({
              ...msg,
              steps: [
                ...msg.steps,
                {
                  kind: "tool",
                  id: uid(),
                  name: String(block.name ?? "tool"),
                  input: JSON.stringify(block.input ?? {}),
                },
              ],
            }));
          }
        }
        return;
      }
      if (type === "message" && event?.role === "tool" && Array.isArray(event.content)) {
        const text = event.content
          .map((block: any) =>
            typeof block?.content === "string" ? block.content : JSON.stringify(block?.content ?? block),
          )
          .join("\n");
        patch(msgId, (msg) => ({ ...msg, steps: [...msg.steps, { kind: "result", id: uid(), text }] }));
      }
    },
    [patch],
  );

  useEffect(() => {
    const off = window.api.onChatEvent((event: ChatEvent) => {
      const msgId = requestMap.current.get(event.requestId);
      if (!msgId) return;

      if (event.type === "chunk" && event.data) {
        const chunk = event.data;
        if (chunk.x_myflicker_event) applyAgentEvent(msgId, chunk.x_myflicker_event);
        if (chunk.x_myflicker?.task_id) {
          patch(msgId, (msg) => ({ ...msg, taskId: chunk.x_myflicker.task_id }));
        }
        const delta = chunk.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta) {
          patch(msgId, (msg) => ({ ...msg, text: msg.text + delta }));
        }
        return;
      }

      const finish = (status: ChatMsg["status"], error?: string) => {
        patch(msgId, (msg) => ({ ...msg, status, error: error ?? msg.error }));
        requestMap.current.delete(event.requestId);
        setActiveRequest((current) => (current === event.requestId ? null : current));
      };
      if (event.type === "done") finish("done");
      else if (event.type === "error") finish("error", event.message || `HTTP ${event.status}`);
      else if (event.type === "aborted") finish("aborted");
    });
    return off;
  }, [applyAgentEvent, patch]);

  // persist the transcript (bounded, storage errors ignored)
  useEffect(() => {
    try {
      let keep = messages.slice(-MAX_PERSISTED);
      let serialized = JSON.stringify(keep);
      while (serialized.length > MAX_STORAGE_BYTES && keep.length > 1) {
        keep = keep.slice(1);
        serialized = JSON.stringify(keep);
      }
      localStorage.setItem(STORAGE_KEY, serialized);
    } catch {
      /* quota exceeded: keep working in memory */
    }
  }, [messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, messages[messages.length - 1]?.text]);

  const send = useCallback(async (override?: string) => {
    const text = (override ?? input).trim();
    if (!text || !running || activeRequest) return;
    setInput("");

    const history = messagesRef.current
      .filter((msg) => msg.text.trim().length > 0)
      .map((msg) => ({ role: msg.role, content: msg.text }));

    const userMsg: ChatMsg = { id: uid(), role: "user", text, steps: [], status: "done" };
    const assistantMsg: ChatMsg = { id: uid(), role: "assistant", text: "", steps: [], status: "streaming" };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);

    const requestId = uid();
    requestMap.current.set(requestId, assistantMsg.id);
    setActiveRequest(requestId);

    const response = await window.api.chatStart({
      requestId,
      body: {
        messages: [...history, { role: "user", content: text }],
        timeout: Number(timeoutSec) || 600,
      },
    });
    if (!response.ok) {
      patch(assistantMsg.id, (msg) => ({ ...msg, status: "error", error: response.error ?? "stream failed" }));
      setActiveRequest(null);
    }
  }, [activeRequest, input, patch, running, timeoutSec]);

  // smoke-test hook: ?prompt=... auto-sends one turn (used by headless capture)
  const autoPrompt = new URLSearchParams(window.location.search).get("prompt") || "";
  const autoSent = useRef(false);
  useEffect(() => {
    if (!running || !autoPrompt || autoSent.current) return;
    autoSent.current = true;
    void send(autoPrompt);
  }, [autoPrompt, running, send]);

  const stop = useCallback(() => {
    if (activeRequest) void window.api.chatAbort(activeRequest);
  }, [activeRequest]);

  return (
    <div className="page chat-page">
      <section className="card chat-card">
        <header className="card-head">
          <div className="row-flex">
            <h2>对话</h2>
            <span className="muted small mono">经 /v1 调用 · {status?.baseUrl ?? ""}</span>
          </div>
          <div className="row-flex">
            <label className="check">
              超时
              <input
                className="input"
                style={{ width: 62, padding: "4px 8px" }}
                value={timeoutSec}
                onChange={(event) => setTimeoutSec(event.target.value)}
              />
              s
            </label>
            <button
              className="btn small ghost"
              onClick={() => {
                setMessages([]);
                try {
                  localStorage.removeItem(STORAGE_KEY);
                } catch {
                  /* ignore */
                }
              }}
            >
              清空
            </button>
          </div>
        </header>

        <div className="chat-body">
          {messages.length === 0 && (
            <div className="agent-bubble plain chat-empty">
              {running
                ? "直接问：agent 会在自己的工作区里读文件、跑命令，每一步 tool call 都会显示在这里。"
                : "服务未启动，先点底部的服务条启动。"}
            </div>
          )}

          {messages.map((msg) =>
            msg.role === "user" ? (
              <div className="msg user" key={msg.id}>
                <div className="bubble">{msg.text}</div>
              </div>
            ) : (
              <AssistantCard key={msg.id} msg={msg} onStop={stop} active={activeRequest !== null} />
            ),
          )}
          <div ref={bottomRef} />
        </div>

        <div className="chat-input">
          <div className="row-flex">
            <input
              className="input"
              placeholder={running ? "问点什么，例如：看下这个仓库的结构" : "服务未启动"}
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
            {activeRequest ? (
              <button className="btn danger" onClick={stop}>
                停止
              </button>
            ) : (
              <button className="btn primary" disabled={!running} onClick={() => void send()}>
                发送
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function AssistantCard({ msg, onStop, active }: { msg: ChatMsg; onStop: () => void; active: boolean }) {
  const badge =
    msg.status === "done" ? "st-success" : msg.status === "error" ? "st-failure" : msg.status === "aborted" ? "st-canceled" : "st-running";
  const label =
    msg.status === "done" ? "完成" : msg.status === "error" ? "失败" : msg.status === "aborted" ? "已停止" : "执行中";

  return (
    <div className="msg agent">
      <div className="agent-bubble">
        <div className="bubble-head">
          <span className="mono small">myflicker</span>
          <span className={`badge ${badge}`}>{label}</span>
          {msg.sessionId && <span className="muted small mono">session {msg.sessionId}</span>}
          {msg.taskId && <span className="muted small mono">{msg.taskId.slice(0, 8)}…</span>}
          {active && msg.status === "streaming" && (
            <button className="btn small ghost" onClick={onStop}>
              停止
            </button>
          )}
        </div>

        {msg.steps.map((step) =>
          step.kind === "tool" ? (
            <div className="tool-card" key={step.id}>
              <span className="tool-name">{step.name}</span>
              <code className="tool-input mono">{step.input}</code>
            </div>
          ) : (
            <details className="tool-result" key={step.id}>
              <summary>tool result</summary>
              <pre className="pre chat-pre">{step.text || "（空）"}</pre>
            </details>
          ),
        )}

        {msg.text && <pre className="pre chat-pre">{msg.text}</pre>}
        {msg.error && <div className="text-error small">{msg.error}</div>}
      </div>
    </div>
  );
}
