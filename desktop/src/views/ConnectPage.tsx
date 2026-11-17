import { useCallback, useEffect, useState } from "react";
import type { ProbeResult, Profile, ProfileList, ServiceStatus } from "../types";

interface Props {
  status: ServiceStatus | null;
  onConnected: (status: ServiceStatus) => void;
}

export default function ConnectPage({ status, onConnected }: Props) {
  const [list, setList] = useState<ProfileList | null>(null);
  const [name, setName] = useState("公司网关");
  const [baseUrl, setBaseUrl] = useState("");
  const [key, setKey] = useState("");
  const [model, setModel] = useState("myflicker-agent");
  const [link, setLink] = useState("");
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [busy, setBusy] = useState<"probe" | "save" | "role" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setList(await window.api.listProfiles());
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const role = list?.role ?? status?.role ?? "provider";

  const test = async () => {
    setError(null);
    setProbe(null);
    setNotice(null);
    setBusy("probe");
    try {
      const result = await window.api.probeProfile({ baseUrl, key });
      setProbe(result);
      if (!result.ok) setError(result.error ?? "连接失败");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setError(null);
    setNotice(null);
    setBusy("save");
    try {
      const profile = await window.api.upsertProfile({ name, baseUrl, key, model });
      const activated = await window.api.activateProfile(profile.id);
      onConnected(activated.status);
      setKey("");
      setProbe(null);
      setNotice(`已保存并切换到「${profile.name}」`);
      await reload();
    } catch (err) {
      setError(String(err).replace(/^Error: /, ""));
    } finally {
      setBusy(null);
    }
  };

  const useProfile = async (profile: Profile) => {
    setError(null);
    setBusy("save");
    try {
      const activated = await window.api.activateProfile(profile.id);
      onConnected(activated.status);
      await reload();
    } catch (err) {
      setError(String(err).replace(/^Error: /, ""));
    } finally {
      setBusy(null);
    }
  };

  const exportLink = async (profile: Profile) => {
    setError(null);
    try {
      const value = await window.api.exportProfile(profile.id);
      await navigator.clipboard.writeText(value);
      setNotice(`已复制「${profile.name}」的连接串`);
    } catch (err) {
      setError(String(err).replace(/^Error: /, ""));
    }
  };

  const remove = async (profile: Profile) => {
    setError(null);
    try {
      setList(await window.api.removeProfile(profile.id));
    } catch (err) {
      setError(String(err).replace(/^Error: /, ""));
    }
  };

  const parseLink = async () => {
    setError(null);
    try {
      const parsed = await window.api.importProfile(link);
      setName(parsed.name || "共享连接");
      setBaseUrl(parsed.baseUrl);
      setKey(parsed.key);
      setLink("");
      setNotice("已解析连接串，请点「测试连接」确认");
    } catch (err) {
      setError(String(err).replace(/^Error: /, ""));
    }
  };

  const switchRole = async (next: "provider" | "client") => {
    setBusy("role");
    try {
      const nextStatus = await window.api.setRole(next);
      onConnected(nextStatus);
      await reload();
    } catch (err) {
      setError(String(err).replace(/^Error: /, ""));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page connect-page">
      <section className="card">
        <div className="card-head">
          <div>
            <h2>这台电脑的用途</h2>
            <span className="muted small">随时可切换，不影响已保存的档案</span>
          </div>
        </div>
        <div className="card-body">
          <div className="row-flex">
            <button
              className={`btn ${role === "provider" ? "primary" : "secondary"}`}
              disabled={busy !== null}
              onClick={() => void switchRole("provider")}
            >
              提供服务
            </button>
            <button
              className={`btn ${role === "client" ? "primary" : "secondary"}`}
              disabled={busy !== null}
              onClick={() => void switchRole("client")}
            >
              连接使用
            </button>
            <span className="muted small">
              {role === "provider" ? "启动本机服务并分享 Key" : "只填地址和 Key，不需要本地依赖"}
            </span>
          </div>
        </div>
      </section>

      {list && (
        <section className="card">
          <div className="card-head">
            <h2>连接档案</h2>
            <span className="muted small">{list.profiles.length} 个</span>
          </div>
          <div className="card-body">
            {list.profiles.map((profile) => (
              <div className="kv-row" key={profile.id}>
                <span className="muted small kv-tag">{profile.kind === "local" ? "本机" : "远端"}</span>
                <span>
                  {profile.name}
                  {profile.id === list.activeId && <span className="text-ok small"> · 当前</span>}
                </span>
                <code className="mono ellipsis">{profile.baseUrl}</code>
                <div className="row-flex">
                  <button
                    className="btn small ghost"
                    disabled={busy !== null || profile.id === list.activeId}
                    onClick={() => void useProfile(profile)}
                  >
                    使用
                  </button>
                  <button className="btn small ghost" onClick={() => void exportLink(profile)}>
                    连接串
                  </button>
                  {!profile.builtin && (
                    <button className="btn small ghost" onClick={() => void remove(profile)}>
                      删除
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <div>
            <h2>新增连接</h2>
            <span className="muted small">填地址与 Key，或粘贴别人分享的连接串</span>
          </div>
        </div>
        <div className="card-body">
          <label className="field">
            <span>名称</span>
            <input className="input" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="field">
            <span>API 地址</span>
            <input
              className="input mono"
              placeholder="http://192.168.1.23:8000"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </label>
          <label className="field">
            <span>API Key</span>
            <input
              className="input mono"
              placeholder="粘贴 key，例如 P9gc…"
              value={key}
              onChange={(event) => setKey(event.target.value)}
            />
          </label>
          <label className="field">
            <span>模型</span>
            <input className="input mono" value={model} onChange={(event) => setModel(event.target.value)} />
          </label>

          <div className="row-flex">
            <input
              className="input mono"
              placeholder="粘贴 myflicker:// 连接串"
              value={link}
              onChange={(event) => setLink(event.target.value)}
            />
            <button className="btn secondary" disabled={!link.trim()} onClick={() => void parseLink()}>
              解析
            </button>
          </div>

          {probe && (
            <div className={`banner ${probe.ok ? "" : "warn"}`}>
              {probe.ok ? (
                <>
                  <span>✓ 服务可达</span>
                  <span>✓ 鉴权通过</span>
                  <span className="mono small">
                    ✓ 模型 {(probe.models && probe.models[0]) || model}
                  </span>
                  <span className="muted small">
                    身份 {probe.health?.identity?.label ?? "—"} · worker{" "}
                    {probe.health?.worker?.online_workers ?? 0}
                  </span>
                </>
              ) : (
                <span>
                  {probe.stage === "health" ? "服务不可达" : probe.stage === "models" ? "鉴权失败" : "网络错误"}
                  ：{probe.error}
                </span>
              )}
            </div>
          )}
          {error && <div className="banner warn">{error}</div>}
          {notice && !error && <div className="banner">{notice}</div>}

          <div className="form-foot">
            <div className="muted small">连接成功后即可在工作区对话；随时可在这里切换档案。</div>
            <div className="row-flex">
              <button className="btn secondary" disabled={busy !== null || !baseUrl || !key} onClick={() => void test()}>
                {busy === "probe" ? "测试中…" : "测试连接"}
              </button>
              <button className="btn primary" disabled={busy !== null || !baseUrl || !key} onClick={() => void save()}>
                {busy === "save" ? "连接中…" : "保存并连接"}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
