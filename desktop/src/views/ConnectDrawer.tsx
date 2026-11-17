import { useEffect } from "react";
import type { ServiceStatus } from "../types";
import ConnectPage from "./ConnectPage";

interface Props {
  open: boolean;
  status: ServiceStatus | null;
  onConnected: (status: ServiceStatus) => void;
  onClose: () => void;
}

export default function ConnectDrawer({ open, status, onConnected, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="drawer-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside className="drawer">
        <header className="drawer-head">
          <h2>连接与档案</h2>
          <button className="icon-btn" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="drawer-body">
          <ConnectPage status={status} onConnected={onConnected} embedded />
        </div>
      </aside>
    </div>
  );
}
