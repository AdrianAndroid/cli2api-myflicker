import { useEffect, useRef, useState } from "react";
import type { BrowserState, ChangeDiff, ChangesListing } from "../types";

interface Props {
  open: boolean;
  cwd?: string;
  onClose: () => void;
}

type Tab = "changes" | "browser";

function statusClass(status: string, untracked: boolean): string {
  if (untracked || status.includes("A")) return "add";
  if (status.includes("D")) return "del";
  if (status.includes("M") || status.includes("R") || status.includes("C")) return "mod";
  return "";
}

function lineClass(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || line.startsWith("index ")) {
    return "diff-meta";
  }
  if (line.startsWith("@@")) return "diff-hunk";
  if (line.startsWith("+")) return "diff-add";
  if (line.startsWith("-")) return "diff-del";
  return "";
}

export default function RightPanel({ open, cwd, onClose }: Props) {
  const [tab, setTab] = useState<Tab>(() =>
    new URLSearchParams(window.location.search).get("browser") === "1" ? "browser" : "changes",
  );
  const [listing, setListing] = useState<ChangesListing | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [diffState, setDiffState] = useState<ChangeDiff | null>(null);
  const [loading, setLoading] = useState(false);
  const [diffLoading, setDiffLoading] = useState(false);
  const [tick, setTick] = useState(0);

  const [browser, setBrowser] = useState<BrowserState>({});
  const [address, setAddress] = useState("");
  const [browserError, setBrowserError] = useState<string | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const off = window.api.onBrowserEvent((state) => {
      setBrowser((prev) => ({ ...prev, ...state }));
    });
    return off;
  }, []);

  useEffect(() => {
    if (browser.url && !browser.url.startsWith("data:")) setAddress(browser.url);
  }, [browser.url]);

  useEffect(() => {
    if (!open) return;
    if (tab !== "changes") return;
    let alive = true;
    setLoading(true);
    setListing(null);
    setSelected(null);
    setDiffState(null);
    window.api
      .listChanges(cwd)
      .then((result) => {
        if (!alive) return;
        setListing(result);
        const first = result.ok && result.git ? result.files?.[0]?.path : undefined;
        if (first) setSelected(first);
      })
      .catch((error) => {
        if (alive) setListing({ ok: false, error: String(error) });
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, tab, cwd, tick]);

  useEffect(() => {
    if (!open || tab !== "changes" || !selected) return;
    let alive = true;
    setDiffLoading(true);
    setDiffState(null);
    window.api
      .changeDiff(cwd, selected)
      .then((result) => {
        if (alive) setDiffState(result);
      })
      .catch((error) => {
        if (alive) setDiffState({ ok: false, error: String(error) });
      })
      .finally(() => {
        if (alive) setDiffLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, tab, cwd, selected, tick]);

  // The browser is a native view; the renderer only tells it which rectangle to cover.
  useEffect(() => {
    if (!open || tab !== "browser") {
      void window.api.browserHide();
      return;
    }
    const host = hostRef.current;
    if (!host) return;
    let alive = true;
    const rect = host.getBoundingClientRect();
    void window.api
      .browserShow({ bounds: { x: rect.left, y: rect.top, width: rect.width, height: rect.height } })
      .then((state) => {
        if (alive) setBrowser((prev) => ({ ...prev, ...state }));
      })
      .catch(() => null);

    const push = () => {
      const next = host.getBoundingClientRect();
      void window.api.browserSetBounds({
        x: next.left,
        y: next.top,
        width: next.width,
        height: next.height,
      });
    };
    const observer = new ResizeObserver(push);
    observer.observe(host);
    window.addEventListener("resize", push);
    return () => {
      alive = false;
      observer.disconnect();
      window.removeEventListener("resize", push);
      void window.api.browserHide();
    };
  }, [open, tab]);

  if (!open) return null;

  const files = listing?.files ?? [];
  const lines = (diffState?.diff ?? "").split("\n");
  const error = browserError || browser.error || null;

  const go = async () => {
    setBrowserError(null);
    const result = await window.api.browserNavigate(address);
    if (!result.ok) setBrowserError(result.error || "无法打开该地址");
  };

  return (
    <aside className="card right-panel">
      <header className="card-head tight right-panel-head">
        <div className="row-flex">
          <h2>{tab === "browser" ? "浏览器" : "变更"}</h2>
          {tab === "changes" && listing?.ok && listing.git && <span className="muted small">{files.length}</span>}
        </div>
        <div className="row-flex">
          {tab === "changes" && (
            <button className="btn small ghost" onClick={() => setTick((value) => value + 1)}>
              刷新
            </button>
          )}
          <button className="icon-btn" aria-label="收起面板" onClick={onClose}>
            ×
          </button>
        </div>
      </header>

      <div className="panel-tabs">
        <button className={`panel-tab ${tab === "changes" ? "active" : ""}`} onClick={() => setTab("changes")}>
          变更
        </button>
        <button className={`panel-tab ${tab === "browser" ? "active" : ""}`} onClick={() => setTab("browser")}>
          浏览器
        </button>
      </div>

      {tab === "changes" && (
        <>
          {loading && <div className="muted small panel-empty">读取中…</div>}
          {!loading && listing && !listing.ok && (
            <div className="banner warn panel-error">
              {listing.error || `该服务不支持变更面板（HTTP ${listing.status ?? "?"}）`}
            </div>
          )}
          {!loading && listing?.ok && !listing.git && (
            <div className="muted small panel-empty">当前项目不是 git 仓库，暂无法展示变更。</div>
          )}
          {!loading && listing?.ok && listing.git && files.length === 0 && (
            <div className="muted small panel-empty">工作区没有未提交的变更。</div>
          )}

          {files.length > 0 && (
            <div className="change-list">
              {files.map((file) => (
                <button
                  key={file.path}
                  className={`change-row ${selected === file.path ? "active" : ""}`}
                  title={file.path}
                  onClick={() => setSelected(file.path)}
                >
                  <span className={`change-status ${statusClass(file.status, file.untracked)}`}>
                    {file.untracked ? "??" : file.status}
                  </span>
                  <span className="change-path">{file.path}</span>
                </button>
              ))}
            </div>
          )}

          <div className="change-diff">
            {!selected && !loading && listing?.ok && listing.git && files.length > 0 && (
              <div className="muted small">选择一个文件查看 diff。</div>
            )}
            {diffLoading && <div className="muted small">读取 diff…</div>}
            {!diffLoading && diffState?.ok && diffState.untracked && (
              <div className="muted small">新增文件，未跟踪（不展示内容）。</div>
            )}
            {!diffLoading && diffState?.ok && !diffState.untracked && (
              <div className="diff-view">
                {diffState.diff ? (
                  lines.map((line, index) => (
                    <div key={index} className={`diff-line ${lineClass(line)}`}>
                      {line || " "}
                    </div>
                  ))
                ) : (
                  <div className="muted small">没有可显示的 diff（可能已暂存或为二进制文件）。</div>
                )}
              </div>
            )}
            {!diffLoading && diffState && !diffState.ok && <div className="banner warn">{diffState.error}</div>}
          </div>
        </>
      )}

      {tab === "browser" && (
        <>
          <div className="browser-toolbar">
            <button
              className="nav-btn"
              title="后退"
              disabled={!browser.canGoBack}
              onClick={() => void window.api.browserBack().then((state) => setBrowser((prev) => ({ ...prev, ...state })))}
            >
              ‹
            </button>
            <button
              className="nav-btn"
              title="前进"
              disabled={!browser.canGoForward}
              onClick={() =>
                void window.api.browserForward().then((state) => setBrowser((prev) => ({ ...prev, ...state })))
              }
            >
              ›
            </button>
            <button
              className="nav-btn"
              title="刷新"
              onClick={() => void window.api.browserReload().then((state) => setBrowser((prev) => ({ ...prev, ...state })))}
            >
              ⟳
            </button>
            <input
              className="input mono browser-address"
              placeholder="https://example.com"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void go();
                }
              }}
            />
            <button className="btn small secondary" onClick={() => void go()}>
              打开
            </button>
          </div>

          <div className="browser-status muted small">
            {error ? <span className="text-error">{error}</span> : browser.loading ? "加载中…" : ""}
          </div>

          <div className="browser-host" ref={hostRef} />
        </>
      )}
    </aside>
  );
}
