import { useEffect, useState } from "react";
import type { WorkspaceListing } from "../types";

interface Props {
  open: boolean;
  current?: string;
  onClose: () => void;
  onPick: (cwd: string) => void;
}

export default function ProjectPicker({ open, current, onClose, onPick }: Props) {
  const [path, setPath] = useState<string | undefined>(current);
  const [listing, setListing] = useState<WorkspaceListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (open) setPath(current);
  }, [open, current]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    setListing(null);
    window.api
      .listWorkspaces(path)
      .then((result) => {
        if (alive) setListing(result);
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
  }, [open, path, reload]);

  if (!open) return null;

  const atRoot = Boolean(listing?.ok && listing.workspace && listing.cwd === listing.workspace);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal project-modal">
        <header className="modal-head">
          <h2>选择工作目录</h2>
          <button className="icon-btn" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="project-path mono" title={listing?.cwd || path || ""}>
          {listing?.cwd || path || "读取中…"}
        </div>

        <div className="row-flex project-tools">
          <button
            className="btn small secondary"
            disabled={!listing?.parent}
            onClick={() => setPath(listing?.parent || undefined)}
          >
            上级
          </button>
          <button
            className="btn small ghost"
            disabled={!listing?.workspace || atRoot}
            onClick={() => setPath(listing?.workspace)}
          >
            回到工作区根
          </button>
          <button className="btn small ghost" onClick={() => setReload((value) => value + 1)}>
            刷新
          </button>
        </div>

        <div className="project-list">
          {loading && <div className="muted small project-empty">读取中…</div>}
          {!loading && listing && !listing.ok && (
            <div className="banner warn">
              {listing.error || `该服务不支持目录浏览（HTTP ${listing.status ?? "?"}）`}
            </div>
          )}
          {!loading && listing?.ok && (listing.dirs?.length ?? 0) === 0 && (
            <div className="muted small project-empty">没有子目录</div>
          )}
          {listing?.dirs?.map((dir) => (
            <button className="project-dir" key={dir.path} title={dir.path} onClick={() => setPath(dir.path)}>
              <span className="project-dir-icon">▸</span>
              <span className="session-title">{dir.name}</span>
            </button>
          ))}
        </div>

        <footer className="modal-foot">
          <span className="muted small">新会话将在这个目录里执行</span>
          <div className="row-flex">
            <button className="btn secondary" onClick={onClose}>
              取消
            </button>
            <button
              className="btn primary"
              disabled={!listing?.ok || !listing.cwd}
              onClick={() => {
                if (listing?.cwd) onPick(listing.cwd);
                onClose();
              }}
            >
              选用此目录
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
