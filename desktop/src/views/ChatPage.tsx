import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatEvent, ServiceStatus } from "../types";
import type { ChatMsg, Session, SessionStore } from "../lib/sessions";
import {
  createSession,
  groupSessions,
  loadStore,
  persistStore,
  relativeTime,
  stepsOf,
  titleFrom,
  uid,
} from "../lib/sessions";

interface Props {
  status: ServiceStatus | null;
}

const EMPTY_STORE: SessionStore = { activeId: "", sessions: [] };
const NO_MESSAGES: ChatMsg[] = [];

export default function ChatPage({ status }: Props) {
  const profileId = status?.profile?.id || "local";
  const [sessionState, setSessionState] = useState<{ profileId: string; store: SessionStore }>(() => ({
    profileId: "local",
    store: loadStore("local"),
  }));
  const store = sessionState.profileId === profileId ? sessionState.store : EMPTY_STORE;
  const active = store.sessions.find((item) => item.id === store.activeId) ?? store.sessions[0] ?? null;
  const messages = active?.messages ?? NO_MESSAGES;

  const [input, setInput] = useState("");
  const [timeoutSec, setTimeoutSec] = useState("600");
  const [activeRequest, setActiveRequest] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");

  const messagesRef = useRef<ChatMsg[]>(messages);
  messagesRef.current = messages;
  const activeRequestRef = useRef<string | null>(null);
  activeRequestRef.current = activeRequest;
  const requestMap = useRef<Map<string, { sessionId: string; msgId: string }>>(new Map());
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const running = status?.state === "running";
  const offlineHint =
    status?.role === "client"
      ? "未连接到服务，先到「连接」页填地址与 Key。"
      : "服务未启动，先到「服务」页启动。";

  const patchMsg = useCallback(
    (sessionId: string, msgId: string, update: (msg: ChatMsg) => ChatMsg) => {
      setSessionState((prev) => {
        if (prev.profileId !== profileId) return prev;
        const sessions = prev.store.sessions.map((session) =>
          session.id === sessionId
            ? { ...session, messages: session.messages.map((msg) => (msg.id === msgId ? update(msg) : msg)) }
            : session,
        );
        return { ...prev, store: { ...prev.store, sessions } };
      });
    },
    [profileId],
  );

  const patchSession = useCallback(
    (sessionId: string, update: (session: Session) => Session) => {
      setSessionState((prev) => {
        if (prev.profileId !== profileId) return prev;
        const sessions = prev.store.sessions.map((session) => (session.id === sessionId ? update(session) : session));
        return { ...prev, store: { ...prev.store, sessions } };
      });
    },
    [profileId],
  );

  const applyAgentEvent = useCallback(
    (sessionId: string, msgId: string, event: any) => {
      const type = event?.type;
      if (type === "system" && event?.subtype === "init") {
        const agentSession = typeof event.sessionId === "string" ? event.sessionId : undefined;
        patchMsg(sessionId, msgId, (msg) => ({ ...msg, sessionId: agentSession ?? msg.sessionId }));
        if (agentSession) patchSession(sessionId, (session) => ({ ...session, sessionId: agentSession }));
        return;
      }
      if (type === "message" && event?.role === "assistant" && Array.isArray(event.content)) {
        for (const block of event.content) {
          if (block?.type === "tool_use") {
            patchMsg(sessionId, msgId, (msg) => ({
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
        patchMsg(sessionId, msgId, (msg) => ({ ...msg, steps: [...msg.steps, { kind: "result", id: uid(), text }] }));
      }
    },
    [patchMsg, patchSession],
  );

  useEffect(() => {
    const off = window.api.onChatEvent((event: ChatEvent) => {
      const target = requestMap.current.get(event.requestId);
      if (!target) return;

      if (event.type === "chunk" && event.data) {
        const chunk = event.data;
        if (chunk.x_myflicker_event) applyAgentEvent(target.sessionId, target.msgId, chunk.x_myflicker_event);
        if (chunk.x_myflicker?.task_id) {
          patchMsg(target.sessionId, target.msgId, (msg) => ({ ...msg, taskId: chunk.x_myflicker.task_id }));
        }
        const delta = chunk.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta) {
          patchMsg(target.sessionId, target.msgId, (msg) => ({ ...msg, text: msg.text + delta }));
        }
        return;
      }

      const finish = (nextStatus: ChatMsg["status"], error?: string) => {
        patchMsg(target.sessionId, target.msgId, (msg) => ({
          ...msg,
          status: nextStatus,
          error: error ?? msg.error,
        }));
        patchSession(target.sessionId, (session) => ({ ...session, updatedAt: new Date().toISOString() }));
        requestMap.current.delete(event.requestId);
        setActiveRequest((current) => (current === event.requestId ? null : current));
      };
      if (event.type === "done") finish("done");
      else if (event.type === "error") finish("error", event.message || `HTTP ${event.status}`);
      else if (event.type === "aborted") finish("aborted");
    });
    return off;
  }, [applyAgentEvent, patchMsg, patchSession]);

  // persist only when the loaded store belongs to the current profile
  useEffect(() => {
    if (sessionState.profileId !== profileId) return;
    persistStore(profileId, sessionState.store);
  }, [sessionState, profileId]);

  // switching profiles swaps every thread and aborts an in-flight stream
  useEffect(() => {
    const pending = activeRequestRef.current;
    if (pending) void window.api.chatAbort(pending);
    requestMap.current.clear();
    setActiveRequest(null);
    setInput("");
    setEditingId(null);
    setSessionState({ profileId, store: loadStore(profileId) });
  }, [profileId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, messages[messages.length - 1]?.text]);

  const send = useCallback(
    async (override?: string) => {
      const text = (override ?? input).trim();
      if (!text || !running || activeRequest || sessionState.profileId !== profileId) return;
      const session = store.sessions.find((item) => item.id === store.activeId) ?? store.sessions[0];
      if (!session) return;
      setInput("");

      const history = messagesRef.current
        .filter((msg) => msg.text.trim().length > 0)
        .map((msg) => ({ role: msg.role, content: msg.text }));

      const userMsg: ChatMsg = { id: uid(), role: "user", text, steps: [], status: "done" };
      const assistantMsg: ChatMsg = { id: uid(), role: "assistant", text: "", steps: [], status: "streaming" };
      const now = new Date().toISOString();

      setSessionState((prev) => {
        if (prev.profileId !== profileId) return prev;
        const sessions = prev.store.sessions.map((item) =>
          item.id === session.id
            ? {
                ...item,
                title: item.title === "新对话" ? titleFrom(text) : item.title,
                updatedAt: now,
                messages: [...item.messages, userMsg, assistantMsg],
              }
            : item,
        );
        return { ...prev, store: { ...prev.store, sessions } };
      });

      const requestId = uid();
      requestMap.current.set(requestId, { sessionId: session.id, msgId: assistantMsg.id });
      setActiveRequest(requestId);

      const response = await window.api.chatStart({
        requestId,
        body: {
          messages: [...history, { role: "user", content: text }],
          timeout: Number(timeoutSec) || 600,
        },
      });
      if (!response.ok) {
        patchMsg(session.id, assistantMsg.id, (msg) => ({
          ...msg,
          status: "error",
          error: response.error ?? "stream failed",
        }));
        setActiveRequest(null);
      }
    },
    [activeRequest, input, patchMsg, profileId, running, sessionState.profileId, store, timeoutSec],
  );

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

  const selectSession = (id: string) => {
    setSessionState((prev) => ({ ...prev, store: { ...prev.store, activeId: id } }));
    setInput("");
    setEditingId(null);
  };

  const addSession = () => {
    const session = createSession();
    setSessionState((prev) => ({
      ...prev,
      store: { activeId: session.id, sessions: [session, ...prev.store.sessions] },
    }));
    setInput("");
    setEditingId(null);
  };

  const removeSession = (id: string) => {
    setSessionState((prev) => {
      if (prev.profileId !== profileId) return prev;
      let sessions = prev.store.sessions.filter((session) => session.id !== id);
      if (sessions.length === 0) sessions = [createSession()];
      const activeId = prev.store.activeId === id ? sessions[0].id : prev.store.activeId;
      return { ...prev, store: { activeId, sessions } };
    });
    if (editingId === id) setEditingId(null);
  };

  const beginRename = (session: Session) => {
    setEditingId(session.id);
    setDraftTitle(session.title);
  };

  const commitRename = (id: string) => {
    const title = draftTitle.trim();
    if (title) {
      setSessionState((prev) => {
        if (prev.profileId !== profileId) return prev;
        const sessions = prev.store.sessions.map((session) =>
          session.id === id ? { ...session, title } : session,
        );
        return { ...prev, store: { ...prev.store, sessions } };
      });
    }
    setEditingId(null);
  };

  const clearCurrent = () => {
    if (!active) return;
    setSessionState((prev) => {
      if (prev.profileId !== profileId) return prev;
      const sessions = prev.store.sessions.map((session) =>
        session.id === active.id ? { ...session, messages: [], sessionId: undefined } : session,
      );
      return { ...prev, store: { ...prev.store, sessions } };
    });
  };

  const groups = groupSessions(store.sessions);

  return (
    <div className="workspace">
      <aside className="card session-pane">
        <header className="card-head tight">
          <div className="row-flex">
            <h2>会话</h2>
            <span className="muted small">{store.sessions.length}</span>
          </div>
          <button className="btn small primary" onClick={addSession}>
            新建
          </button>
        </header>

        <div className="session-scroll">
          {groups.length === 0 && <div className="muted small session-empty">还没有会话</div>}
          {groups.map((group) => (
            <div key={group.label}>
              <div className="session-group-label">{group.label}</div>
              {group.items.map((session) => (
                <div key={session.id} className={`session-item ${session.id === active?.id ? "active" : ""}`}>
                  {editingId === session.id ? (
                    <input
                      className="input session-rename"
                      value={draftTitle}
                      autoFocus
                      onChange={(event) => setDraftTitle(event.target.value)}
                      onBlur={() => commitRename(session.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          commitRename(session.id);
                        } else if (event.key === "Escape") {
                          event.preventDefault();
                          setEditingId(null);
                        }
                      }}
                    />
                  ) : (
                    <button
                      className="session-main"
                      onClick={() => selectSession(session.id)}
                      onDoubleClick={() => beginRename(session)}
                      title="双击重命名"
                    >
                      <span className="session-title">{session.title}</span>
                      <span className="session-meta">
                        {relativeTime(session.updatedAt)}
                        {stepsOf(session) > 0 ? ` · ${stepsOf(session)} 步` : ""}
                      </span>
                    </button>
                  )}
                  <button className="session-del" title="删除会话" onClick={() => removeSession(session.id)}>
                    ×
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
      </aside>

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
            <button className="btn small ghost" onClick={clearCurrent} disabled={!active || active.messages.length === 0}>
              清空
            </button>
          </div>
        </header>

        <div className="chat-body">
          {messages.length === 0 && (
            <div className="agent-bubble plain chat-empty">
              {running
                ? "直接问：agent 会在自己的工作区里读文件、跑命令，每一步 tool call 都会显示在这里。"
                : offlineHint}
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
              placeholder={
                running
                  ? "问点什么，例如：看下这个仓库的结构"
                  : status?.role === "client"
                    ? "未连接到服务"
                    : "服务未启动"
              }
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
