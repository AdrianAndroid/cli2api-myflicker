"""Per-caller identity and workspace isolation.

Why a per-key working directory is enough to isolate conversation context:
myflicker stores sessions under ``~/.myflicker/projects/<encoded-cwd>/`` and
``-c/--continue`` resumes the latest session *of that project*. Give every API
key its own directory and ``-c`` can only ever see that key's own history
(verified empirically, see README section 14).

Credentials stay shared on purpose (one model quota), files and sessions do not.
"""

from __future__ import annotations

import hashlib
import ipaddress
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional

BASE_DIR = Path(__file__).resolve().parent


def _env(name: str, default: str = "") -> str:
    value = os.getenv(name)
    return default if value is None or value.strip() == "" else value.strip()


@dataclass(frozen=True)
class Identity:
    label: str
    key: str
    namespace: str
    is_admin: bool = False

    @property
    def workspace(self) -> Path:
        return workspace_root() / self.label

    def ensure_workspace(self) -> Path:
        path = self.workspace
        (path / "uploads").mkdir(parents=True, exist_ok=True)
        return path


def workspace_root() -> Path:
    raw = _env("WORKSPACE_ROOT", str(BASE_DIR / "workspace"))
    path = Path(raw).expanduser()
    if not path.is_absolute():
        path = (BASE_DIR / path).resolve()
    return path


def sandbox_enabled() -> bool:
    return _env("SANDBOX_ENFORCE", "1") not in ("0", "false", "False", "no")


def sandbox_applies_to(ip: str) -> bool:
    """Loopback (the desktop operator) keeps full disk access unless forced."""
    if not sandbox_enabled():
        return False
    if _env("SANDBOX_ENFORCE_LOOPBACK", "0") in ("1", "true", "True", "yes"):
        return True
    try:
        return not ipaddress.ip_address(ip).is_loopback
    except ValueError:
        return True


def _namespace(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:12]


def _parse_api_keys(raw: str) -> List[Dict[str, str]]:
    """``alice:key1,bob:key2`` -> [{'label': 'alice', 'key': 'key1'}, ...]."""
    entries: List[Dict[str, str]] = []
    seen = set()
    for chunk in [c.strip() for c in raw.split(",") if c.strip()]:
        if ":" in chunk:
            label, key = chunk.split(":", 1)
            label, key = label.strip(), key.strip()
        else:
            key = chunk.strip()
            label = f"key-{_namespace(key)}"[:16]
        if not key or label in seen:
            continue
        seen.add(label)
        entries.append({"label": label, "key": key})
    return entries


def load_identities() -> Dict[str, Identity]:
    """key -> Identity. Falls back to the legacy single API_KEY."""
    identities: Dict[str, Identity] = {}
    for entry in _parse_api_keys(_env("API_KEYS", "")):
        identity = Identity(entry["label"], entry["key"], _namespace(entry["key"]))
        identities[identity.key] = identity

    legacy = _env("API_KEY", "")
    if legacy and legacy not in identities:
        identities[legacy] = Identity("default", legacy, _namespace(legacy))

    admin = _env("ADMIN_API_KEY", "")
    if admin:
        identities[admin] = Identity("admin", admin, _namespace(admin), is_admin=True)
    return identities


def resolve_key(key: Optional[str]) -> Optional[Identity]:
    if not key:
        return None
    return load_identities().get(key)


def within(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except (ValueError, OSError):
        return False


def resolve_cwd(identity: Identity, requested: Optional[str], client_ip: str) -> Path:
    """Return the working directory for this task, enforcing the sandbox.

    Raises ``PermissionError`` when a LAN caller tries to leave its workspace.
    """
    workspace = identity.ensure_workspace()
    candidate = (requested or "").strip()

    if not candidate:
        return workspace

    path = Path(candidate).expanduser()
    if not path.is_absolute():
        path = (workspace / path).resolve()

    if sandbox_applies_to(client_ip) and not identity.is_admin and not within(path, workspace):
        raise PermissionError(
            f"cwd '{path}' is outside your workspace '{workspace}'"
        )
    return path
