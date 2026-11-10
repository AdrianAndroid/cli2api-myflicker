"""One single-concurrency Celery worker per API key label.

Users run in parallel (different workspaces, different queues), while a single
user's tasks stay strictly serial inside their own worker. The supervisor keeps
the set of workers in sync with ``API_KEYS``: adding/removing a label in .env
takes effect within a few seconds without touching other users' workers.
"""

from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(dotenv_path=BASE_DIR / ".env")

from identity import Identity, load_identities  # noqa: E402


def queue_for(label: str) -> str:
    return f"{os.getenv('CELERY_QUEUE', 'myflicker')}:{label}"


class WorkerSupervisor:
    def __init__(self) -> None:
        self.children: dict[str, subprocess.Popen] = {}
        self.backend_root = BASE_DIR
        self.python = self._python()
        self.running = True

    def _python(self) -> str:
        candidates = [
            BASE_DIR / ".venv" / "bin" / "python",
            Path(sys.executable),
        ]
        for candidate in candidates:
            if candidate.exists():
                return str(candidate)
        return sys.executable

    def _env(self) -> dict[str, str]:
        env = os.environ.copy()
        env.setdefault("PYTHONUNBUFFERED", "1")
        env.setdefault("PYTHONDONTWRITEBYTECODE", "1")
        return env

    def _spawn(self, label: str) -> subprocess.Popen:
        queue = queue_for(label)
        args = [
            self.python,
            "-m",
            "celery",
            "-A",
            "celery_tasks.celery_app",
            "worker",
            "--concurrency=1",
            "--loglevel=info",
            "-Q",
            queue,
            "-n",
            f"{label}@%h",
        ]
        child = subprocess.Popen(
            args,
            cwd=self.backend_root,
            env=self._env(),
        )
        print(f"[supervisor] worker '{label}' started pid={child.pid} queue={queue}", flush=True)
        return child

    def sync(self) -> None:
        labels = {
            identity.label: identity
            for identity in load_identities().values()
            if not identity.is_admin
        }
        if not labels:
            labels = {"default": Identity("default", "unused", "unused")}
        for label in list(self.children):
            if label not in labels:
                child = self.children.pop(label)
                print(f"[supervisor] stopping worker '{label}' (key removed)", flush=True)
                try:
                    if os.name == "posix":
                        os.killpg(os.getpgid(child.pid), signal.SIGTERM)
                    else:
                        child.terminate()
                except (ProcessLookupError, PermissionError):
                    pass
        for label in labels:
            if label not in self.children:
                self.children[label] = self._spawn(label)
        for label, child in list(self.children.items()):
            code = child.poll()
            if code is not None:
                print(f"[supervisor] worker '{label}' exited code={code}, restarting in 3s", flush=True)
                del self.children[label]
                time.sleep(3)
                self.children[label] = self._spawn(label)

    def run(self, poll_seconds: float = 5.0) -> None:
        signal.signal(signal.SIGTERM, self._shutdown)
        signal.signal(signal.SIGINT, self._shutdown)
        print(f"[supervisor] managing per-user workers from {BASE_DIR}", flush=True)
        while self.running:
            try:
                self.sync()
            except Exception as exc:  # noqa: BLE001 - keep supervising
                print(f"[supervisor] sync error: {exc}", flush=True)
            deadline = time.monotonic() + poll_seconds
            while self.running and time.monotonic() < deadline:
                time.sleep(0.2)

    def _shutdown(self, *_args) -> None:
        print("[supervisor] shutting down all workers", flush=True)
        self.running = False
        for label, child in self.children.items():
            try:
                if os.name == "posix":
                    os.killpg(os.getpgid(child.pid), signal.SIGTERM)
                else:
                    child.terminate()
            except (ProcessLookupError, PermissionError):
                pass


if __name__ == "__main__":
    WorkerSupervisor().run()
