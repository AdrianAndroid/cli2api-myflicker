export type Step =
  | { kind: "tool"; id: string; name: string; input: string }
  | { kind: "result"; id: string; text: string };

export interface ChatMsg {
  id: string;
  role: "user" | "assistant";
  text: string;
  steps: Step[];
  status: "streaming" | "done" | "error" | "aborted";
  taskId?: string;
  sessionId?: string;
  error?: string;
}

export interface Session {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  sessionId?: string;
  cwd?: string;
  messages: ChatMsg[];
}

export interface SessionStore {
  activeId: string;
  sessions: Session[];
}

export interface SessionGroup {
  label: string;
  items: Session[];
}

const SESSIONS_PREFIX = "myflicker.sessions.v1";
const LEGACY_PREFIX = "myflicker.chat.messages.v1";
const MAX_SESSIONS = 50;
const MAX_MESSAGES = 60;
const MAX_BYTES = 1_500_000;

export const uid = () => Math.random().toString(36).slice(2, 10);

export function createSession(title = "新对话", messages: ChatMsg[] = [], cwd?: string): Session {
  const now = new Date().toISOString();
  return { id: uid(), title, createdAt: now, updatedAt: now, cwd, messages };
}

export function titleFrom(text: string): string {
  const first = text.trim().split("\n")[0].trim();
  return first ? first.slice(0, 24) : "新对话";
}

export function stepsOf(session: Session): number {
  return session.messages.reduce((total, msg) => total + msg.steps.length, 0);
}

export function relativeTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (date >= today) {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date >= yesterday) return "昨天";
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export function groupSessions(sessions: Session[]): SessionGroup[] {
  const sorted = [...sessions].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const buckets: Array<{ label: string; items: Session[] }> = [
    { label: "今天", items: [] },
    { label: "昨天", items: [] },
    { label: "更早", items: [] },
  ];
  for (const session of sorted) {
    const date = new Date(session.updatedAt);
    const bucket = date >= today ? buckets[0] : date >= yesterday ? buckets[1] : buckets[2];
    bucket.items.push(session);
  }
  return buckets.filter((bucket) => bucket.items.length > 0);
}

function sanitizeMessages(value: unknown): ChatMsg[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is ChatMsg => Boolean(item && typeof item === "object" && (item as ChatMsg).id))
    .map((msg) => ({
      ...msg,
      steps: Array.isArray(msg.steps) ? msg.steps : [],
      status: msg.status === "streaming" ? "aborted" : msg.status,
    }));
}

function normalizeSession(value: unknown): Session | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<Session>;
  if (typeof raw.id !== "string") return null;
  const messages = sanitizeMessages(raw.messages);
  const createdAt = typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString();
  const updatedAt = typeof raw.updatedAt === "string" ? raw.updatedAt : createdAt;
  return {
    id: raw.id,
    title: typeof raw.title === "string" && raw.title ? raw.title : titleFrom(messages.find((m) => m.role === "user")?.text ?? ""),
    createdAt,
    updatedAt,
    sessionId: typeof raw.sessionId === "string" ? raw.sessionId : undefined,
    cwd: typeof raw.cwd === "string" ? raw.cwd : undefined,
    messages,
  };
}

export function loadStore(profileId: string): SessionStore {
  const key = `${SESSIONS_PREFIX}:${profileId}`;
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SessionStore>;
      const sessions = Array.isArray(parsed.sessions)
        ? parsed.sessions.map(normalizeSession).filter((item): item is Session => Boolean(item))
        : [];
      if (sessions.length > 0) {
        const activeId = sessions.some((item) => item.id === parsed.activeId) ? String(parsed.activeId) : sessions[0].id;
        return { activeId, sessions };
      }
    }
  } catch {
    /* corrupted store: fall through to migration */
  }

  const legacyKey = `${LEGACY_PREFIX}:${profileId}`;
  const legacy = localStorage.getItem(legacyKey) || (profileId === "local" ? localStorage.getItem(LEGACY_PREFIX) : null);
  if (legacy) {
    try {
      const messages = sanitizeMessages(JSON.parse(legacy));
      if (messages.length > 0) {
        const migrated = createSession("历史对话", messages);
        const store = { activeId: migrated.id, sessions: [migrated] };
        persistStore(profileId, store);
        localStorage.removeItem(legacyKey);
        localStorage.removeItem(LEGACY_PREFIX);
        return store;
      }
    } catch {
      /* ignore and start fresh */
    }
  }

  const fresh = createSession();
  return { activeId: fresh.id, sessions: [fresh] };
}

export function projectLabel(cwd?: string): string {
  if (!cwd) return "默认目录";
  const parts = cwd.split("/").filter(Boolean);
  return parts[parts.length - 1] || "默认目录";
}

export function persistStore(profileId: string, store: SessionStore): void {
  try {
    const sessions = store.sessions.slice(0, MAX_SESSIONS).map((session) => ({
      ...session,
      messages: session.messages.slice(-MAX_MESSAGES),
    }));
    let payload = { activeId: store.activeId, sessions };
    let serialized = JSON.stringify(payload);
    while (serialized.length > MAX_BYTES && payload.sessions.length > 1) {
      payload = { ...payload, sessions: payload.sessions.slice(0, -1) };
      serialized = JSON.stringify(payload);
    }
    localStorage.setItem(`${SESSIONS_PREFIX}:${profileId}`, serialized);
  } catch {
    /* quota exceeded: keep working in memory */
  }
}
