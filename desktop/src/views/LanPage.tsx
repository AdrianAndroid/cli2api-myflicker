import { useEffect, useState } from "react";
import type { ServiceStatus } from "../types";
import { useEnv } from "../lib/useEnv";

interface Props {
  status: ServiceStatus | null;
}

export default function LanPage({ status }: Props) {
  const { env, save } = useEnv();
  const [urls, setUrls] = useState<Array<{ iface: string; url: string }>>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    void window.api.netUrls().then(setUrls);
  }, []);

  const host = env?.API_HOST ?? "";
  const lanEnabled = host === "0.0.0.0" || host === "::";
  const security = status?.health?.security;
  const sampleUrl = urls.find((item) => !item.url.includes("127.0.0.1"))?.url ?? "http://<LAN-IP>:8000";
  const isMac = navigator.userAgent.includes("Mac");

  const copy = async (value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(value);
    window.setTimeout(() => setCopied(null), 1500);
  };

  const switchMode = async (enabled: boolean) => {
    await save({ API_HOST: enabled ? "0.0.0.0" : "127.0.0.1" });
    setDirty(true);
  };

  return (
    <div className="page">
      <section className="card">
        <header className="card-head">
          <h2>访问范围</h2>
          <span className="muted small">改动后需要重启服务生效</span>
        </header>
        <div className="card-body">
          <div className="segmented">
            <button className={!lanEnabled ? "active" : ""} onClick={() => switchMode(false)}>
              仅本机 127.0.0.1
            </button>
            <button className={lanEnabled ? "active" : ""} onClick={() => switchMode(true)}>
              局域网 0.0.0.0:{status?.port ?? 8000}
            </button>
          </div>
          {lanEnabled ? (
            <div className="banner inline warn">
              已对外暴露：任何持有 API Key 且来源 IP 在 ALLOWED_CIDRS 内的机器都能提交 myflicker 任务。
            </div>
          ) : (
            <div className="muted small">只有本机可以访问，最安全。</div>
          )}
          {dirty && (
            <div className="row-flex">
              <span className="text-warn small">配置已保存，重启服务后生效</span>
              <button className="btn small primary" onClick={() => void window.api.restart()}>
                立即重启
              </button>
            </div>
          )}
        </div>
      </section>

      <section className="card">
        <header className="card-head">
          <h2>调用地址</h2>
          <button className="btn small ghost" onClick={() => void window.api.netUrls().then(setUrls)}>
            刷新
          </button>
        </header>
        <div className="card-body">
          {!lanEnabled && <div className="muted small">当前仅本机监听，局域网地址不可用。</div>}
          {urls.map((item) => (
            <div className="kv-row" key={item.url}>
              <span className="muted small kv-tag">{item.iface}</span>
              <code className={`mono ${lanEnabled || item.url.includes("127.0.0.1") ? "" : "dim"}`}>{item.url}</code>
              <button className="btn small ghost" onClick={() => void copy(item.url)}>
                {copied === item.url ? "已复制" : "复制"}
              </button>
            </div>
          ))}
          <div className="muted small">
            `<code>.local</code>` 走 Bonjour/mDNS，IP 变化后仍然可用（Windows 10+ 支持）。
          </div>
        </div>
      </section>

      <section className="card">
        <header className="card-head">
          <h2>API Key</h2>
          <span className="muted small">只存在主进程与 .env，界面始终掩码显示</span>
        </header>
        <div className="card-body">
          <div className="kv-row">
            <span className="muted small kv-tag">task</span>
            <code className="mono">{env?.API_KEY || "未设置"}</code>
            <button
              className="btn small ghost"
              onClick={async () => {
                const result = await window.api.rotateKey("API_KEY");
                setFreshKey(result.value);
              }}
            >
              轮换
            </button>
          </div>
          <div className="kv-row">
            <span className="muted small kv-tag">admin</span>
            <code className="mono">{env?.ADMIN_API_KEY || "（未设置，复用 task key）"}</code>
            <button
              className="btn small ghost"
              onClick={async () => {
                const result = await window.api.rotateKey("ADMIN_API_KEY");
                setFreshKey(result.value);
              }}
            >
              轮换
            </button>
          </div>

          {freshKey && (
            <div className="banner inline warn">
              <span>新 Key（只显示这一次）：</span>
              <code className="mono">{freshKey}</code>
              <button className="btn small ghost" onClick={() => void copy(freshKey)}>
                复制
              </button>
            </div>
          )}

          <div className="muted small">轮换后需要重启服务，且要同步更新调用方（Harness / curl / 其它机器）。</div>
        </div>
      </section>

      <section className="card">
        <header className="card-head">
          <h2>调用示例</h2>
        </header>
        <div className="card-body">
          <pre className="pre">
            {`curl -s ${sampleUrl}/api/myflicker/health \\
  -H "X-API-Key: $MYFLICKER_KEY"

curl -s -X POST ${sampleUrl}/api/myflicker/submit \\
  -H "X-API-Key: $MYFLICKER_KEY" -H "Content-Type: application/json" \\
  -d '{"args":["list","--verbose"]}'`}
          </pre>
          <button className="btn small ghost" onClick={() => void copy(`curl -s ${sampleUrl}/api/myflicker/health -H "X-API-Key: $MYFLICKER_KEY"`)}>
            复制第一条
          </button>
        </div>
      </section>

      <section className="card">
        <header className="card-head">
          <h2>安全策略</h2>
          <span className="muted small">来自 /health（服务运行时可读）</span>
        </header>
        <div className="card-body">
          <div className="kv-row">
            <span className="muted small kv-tag">允许网段</span>
            <code className="mono">{security?.allowed_cidrs.join(", ") ?? env?.ALLOWED_CIDRS ?? "—"}</code>
          </div>
          <div className="kv-row">
            <span className="muted small kv-tag">限流</span>
            <code className="mono">
              {security?.rate_limit_per_min ? `${security.rate_limit_per_min} 次/分` : env?.RATE_LIMIT_PER_MIN ? `${env.RATE_LIMIT_PER_MIN} 次/分` : "关闭"}
            </code>
          </div>
          <div className="kv-row">
            <span className="muted small kv-tag">子命令白名单</span>
            <code className="mono">{security?.allowed_args_regex ?? env?.ALLOWED_ARGS_REGEX ?? "未启用"}</code>
          </div>
          <div className="kv-row">
            <span className="muted small kv-tag">队列上限</span>
            <code className="mono">
              {security ? String(status?.health?.max_queue_depth ?? "—") : env?.MAX_QUEUE_DEPTH ?? "—"}
            </code>
          </div>
          <div className="banner inline">
            <span>
              {isMac
                ? "macOS 防火墙需要放行 python/uvicorn 的入站连接（系统设置 › 网络 › 防火墙）。"
                : "请确认系统防火墙放行了网关端口的入站连接。"}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
