import { useEffect, useState } from "react";
import type { ChangeDiff, ChangesListing } from "../types";

interface Props {
  open: boolean;
  cwd?: string;
  onClose: () => void;
}

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
  const [listing, setListing] = useState<ChangesListing | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [diffState, setDiffState] = useState<ChangeDiff | null>(null);
  const [loading, setLoading] = useState(false);
  const [diffLoading, setDiffLoading] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!open) return;
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
  }, [open, cwd, tick]);

  useEffect(() => {
    if (!open || !selected) return;
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
  }, [open, cwd, selected, tick]);

  if (!open) return null;

  const files = listing?.files ?? [];
  const lines = (diffState?.diff ?? "").split("\n");

  return (
    <aside className="card right-panel">
      <header className="card-head tight right-panel-head">
        <div className="row-flex">
          <h2>变更</h2>
          {listing?.ok && listing.git && <span className="muted small">{files.length}</span>}
        </div>
        <div className="row-flex">
          <button className="btn small ghost" onClick={() => setTick((value) => value + 1)}>
            刷新
          </button>
          <button className="icon-btn" aria-label="收起面板" onClick={onClose}>
            ×
          </button>
        </div>
      </header>

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
    </aside>
  );
}
