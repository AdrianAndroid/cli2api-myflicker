import { useEffect, useMemo, useState } from "react";
import type { ServiceStatus } from "../types";
import { useEnv } from "../lib/useEnv";

interface Props {
  status: ServiceStatus | null;
}

type FieldType = "text" | "number" | "file" | "dir" | "json";

const FIELDS: Array<{ key: string; label: string; type: FieldType; hint?: string }> = [
  { key: "MYFLICKER_BIN", label: "myflicker 可执行文件", type: "file", hint: "建议绝对路径，不依赖 PATH" },
  { key: "MYFLICKER_CWD", label: "默认工作目录", type: "dir" },
  { key: "DEFAULT_TIMEOUT", label: "默认超时 (秒)", type: "number" },
  { key: "MAX_TIMEOUT", label: "最大超时 (秒)", type: "number" },
  { key: "API_HOST", label: "监听地址", type: "text", hint: "127.0.0.1 仅本机 / 0.0.0.0 局域网" },
  { key: "API_PORT", label: "监听端口", type: "number" },
  { key: "REDIS_URL", label: "Redis (状态存储)", type: "text" },
  { key: "CELERY_BROKER_URL", label: "Celery Broker", type: "text" },
  { key: "CELERY_RESULT_BACKEND", label: "Celery Backend", type: "text" },
  { key: "REDIS_BIN", label: "redis-server 路径", type: "text", hint: "桌面端检测不到 Redis 时用它启动" },
  { key: "LOG_DIR", label: "日志目录", type: "text" },
  { key: "MAX_QUEUE_DEPTH", label: "队列上限", type: "number", hint: "0 = 不限制" },
  { key: "RATE_LIMIT_PER_MIN", label: "限流 (次/分)", type: "number", hint: "0 = 关闭" },
  { key: "ALLOWED_CIDRS", label: "允许网段", type: "text", hint: "逗号分隔；空 = 不限制" },
  { key: "ALLOWED_ARGS_REGEX", label: "子命令白名单正则", type: "text", hint: "例如 ^(list|run|status)\\b" },
  { key: "EXTRA_ENV", label: "扩展环境变量", type: "json", hint: "单行 JSON，注入到每个 myflicker 进程" },
];

export default function SettingsPage({ status }: Props) {
  const { env, path, save, reload } = useEnv();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [freshKey, setFreshKey] = useState<string | null>(null);

  useEffect(() => {
    if (!env) return;
    const next: Record<string, string> = {};
    for (const field of FIELDS) next[field.key] = env[field.key] ?? "";
    setDraft(next);
    setDirty(false);
  }, [env]);

  const changed = useMemo(() => {
    if (!env) return [] as string[];
    return FIELDS.filter((field) => (draft[field.key] ?? "") !== (env[field.key] ?? "")).map((field) => field.key);
  }, [draft, env]);

  const setValue = (key: string, value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const persist = async () => {
    const patch: Record<string, string> = {};
    for (const key of changed) patch[key] = (draft[key] ?? "").replace(/\n/g, "");
    await save(patch);
    setMessage(`已保存 ${changed.length} 项，重启服务后生效`);
    setDirty(false);
  };

  return (
    <div className="page">
      <section className="card">
        <header className="card-head">
          <h2>配置</h2>
          <span className="muted small mono ellipsis">{path || ".env"}</span>
        </header>
        <div className="card-body">
          <div className="settings-grid">
            {FIELDS.map((field) => (
              <label className="field" key={field.key}>
                <span>
                  {field.label}
                  {field.hint && <em className="hint">{field.hint}</em>}
                </span>
                <div className="row-flex">
                  <input
                    className="input mono"
                    type={field.type === "number" ? "number" : "text"}
                    value={draft[field.key] ?? ""}
                    onChange={(event) => setValue(field.key, event.target.value)}
                  />
                  {field.type === "file" && (
                    <button
                      className="btn small ghost"
                      onClick={async () => {
                        const picked = await window.api.pickFile();
                        if (picked) setValue(field.key, picked);
                      }}
                    >
                      选择
                    </button>
                  )}
                  {field.type === "dir" && (
                    <button
                      className="btn small ghost"
                      onClick={async () => {
                        const picked = await window.api.pickDir();
                        if (picked) setValue(field.key, picked);
                      }}
                    >
                      选择
                    </button>
                  )}
                </div>
              </label>
            ))}
          </div>

          <div className="form-foot">
            <div className="muted small">
              {status?.state === "running" ? "服务运行中" : "服务未启动"}
              {dirty && " · 有未保存改动"}
              {message && <span className="text-ok"> · {message}</span>}
            </div>
            <div className="row-flex">
              <button className="btn ghost" onClick={() => void reload()}>
                重新读取
              </button>
              <button className="btn primary" disabled={changed.length === 0} onClick={() => void persist()}>
                保存 ({changed.length})
              </button>
              {message && status?.state === "running" && (
                <button className="btn" onClick={() => void window.api.restart()}>
                  立即重启
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <header className="card-head">
          <h2>密钥</h2>
          <span className="muted small">掩码显示，轮换后立即写入 .env</span>
        </header>
        <div className="card-body">
          <div className="kv-row">
            <span className="muted small kv-tag">API_KEY</span>
            <code className="mono">{env?.API_KEY || "未设置"}</code>
            <button
              className="btn small ghost"
              onClick={async () => {
                const result = await window.api.rotateKey("API_KEY");
                setFreshKey(result.value);
                void reload();
              }}
            >
              轮换
            </button>
          </div>
          <div className="kv-row">
            <span className="muted small kv-tag">ADMIN_API_KEY</span>
            <code className="mono">{env?.ADMIN_API_KEY || "（未设置）"}</code>
            <button
              className="btn small ghost"
              onClick={async () => {
                const result = await window.api.rotateKey("ADMIN_API_KEY");
                setFreshKey(result.value);
                void reload();
              }}
            >
              轮换
            </button>
          </div>
          {freshKey && (
            <div className="banner inline warn">
              <span>新 Key（仅显示一次）：</span>
              <code className="mono">{freshKey}</code>
              <button className="btn small ghost" onClick={() => navigator.clipboard.writeText(freshKey)}>
                复制
              </button>
            </div>
          )}
        </div>
      </section>

      <section className="card">
        <header className="card-head">
          <h2>当前生效值</h2>
          <span className="muted small">来自运行中的服务 /health</span>
        </header>
        <div className="card-body">
          {status?.health ? (
            <>
              <div className="kv-row">
                <span className="muted small kv-tag">bind</span>
                <code className="mono">{status.health.bind}</code>
              </div>
              <div className="kv-row">
                <span className="muted small kv-tag">myflicker</span>
                <code className="mono ellipsis">{status.health.myflicker_bin}</code>
              </div>
              <div className="kv-row">
                <span className="muted small kv-tag">cwd</span>
                <code className="mono ellipsis">{status.health.myflicker_cwd || "（继承 worker）"}</code>
              </div>
              <div className="kv-row">
                <span className="muted small kv-tag">timeout</span>
                <code className="mono">
                  {status.health.default_timeout}s（上限 {status.health.max_timeout}s）
                </code>
              </div>
              <div className="kv-row">
                <span className="muted small kv-tag">log_dir</span>
                <code className="mono ellipsis">{status.health.log_dir}</code>
              </div>
            </>
          ) : (
            <div className="muted small">服务未启动，暂无生效值。</div>
          )}
        </div>
      </section>
    </div>
  );
}
