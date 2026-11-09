"""Celery task layer for the myflicker HTTP gateway.

Sole execution point for the myflicker CLI. Nothing else in this project is
allowed to spawn myflicker, and the worker MUST be started with
``--concurrency=1`` so that only one myflicker process exists at a time.

Start the worker with:
    celery -A celery_tasks.celery_app worker --concurrency=1 --loglevel=info
"""

from __future__ import annotations

import json
import logging
import os
import shlex
import signal
import socket
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import redis
from celery import Celery
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(dotenv_path=BASE_DIR / ".env")

# --------------------------------------------------------------------------- #
# logging
# --------------------------------------------------------------------------- #
logger = logging.getLogger("myflicker.gateway")
if not logger.handlers:
    _handler = logging.StreamHandler(sys.stdout)
    _handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)s [%(name)s] %(message)s")
    )
    logger.addHandler(_handler)
logger.setLevel(logging.INFO)
logger.propagate = False


# --------------------------------------------------------------------------- #
# config (everything comes from .env, nothing is hardcoded at call sites)
# --------------------------------------------------------------------------- #
def _env_str(name: str, default: str = "") -> str:
    value = os.getenv(name)
    return default if value is None or value.strip() == "" else value.strip()


def _env_float(name: str, default: float) -> float:
    try:
        return float(_env_str(name, str(default)))
    except (TypeError, ValueError):
        logger.warning("invalid float for %s, fallback to %s", name, default)
        return float(default)


def _env_int(name: str, default: int) -> int:
    try:
        return int(float(_env_str(name, str(default))))
    except (TypeError, ValueError):
        logger.warning("invalid int for %s, fallback to %s", name, default)
        return int(default)


def _env_json(name: str, default: Any) -> Any:
    raw = _env_str(name, "")
    if not raw:
        return default
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("%s is not valid JSON, ignored", name)
        return default


MYFLICKER_BIN: str = _env_str("MYFLICKER_BIN", "myflicker")
MYFLICKER_CWD: Optional[str] = _env_str("MYFLICKER_CWD", "") or None
DEFAULT_TIMEOUT: float = _env_float("DEFAULT_TIMEOUT", 300.0)
MAX_TIMEOUT: float = _env_float("MAX_TIMEOUT", 3600.0)

REDIS_URL: str = _env_str("REDIS_URL", "redis://127.0.0.1:6379/0")
CELERY_BROKER_URL: str = _env_str("CELERY_BROKER_URL", REDIS_URL)
CELERY_RESULT_BACKEND: str = _env_str("CELERY_RESULT_BACKEND", REDIS_URL)
CELERY_QUEUE: str = _env_str("CELERY_QUEUE", "myflicker")

TASK_KEY_PREFIX: str = _env_str("TASK_KEY_PREFIX", "myflicker:task")
RESULT_TTL: int = _env_int("RESULT_TTL", 86400)
MAX_OUTPUT_CHARS: int = _env_int("MAX_OUTPUT_CHARS", 200_000)
LOG_DIR: Path = Path(_env_str("LOG_DIR", "logs")).expanduser()
if not LOG_DIR.is_absolute():
    LOG_DIR = (BASE_DIR / LOG_DIR).resolve()
TASK_LOG_DIR: Path = LOG_DIR / "tasks"
UNIFIED_LOG_FILE: Path = LOG_DIR / "myflicker_tasks.jsonl"

EXTRA_ENV: Dict[str, str] = {}
_raw_extra = _env_json("EXTRA_ENV", {})
if isinstance(_raw_extra, dict):
    EXTRA_ENV = {str(k): str(v) for k, v in _raw_extra.items()}
else:
    logger.warning("EXTRA_ENV must be a JSON object, ignored")


def ensure_log_dirs() -> None:
    TASK_LOG_DIR.mkdir(parents=True, exist_ok=True)


# --------------------------------------------------------------------------- #
# helpers: time / redis / state
# --------------------------------------------------------------------------- #
def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


_redis_client: Optional[redis.Redis] = None


def get_redis() -> redis.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = redis.Redis.from_url(
            REDIS_URL,
            decode_responses=True,
            socket_timeout=5,
            socket_connect_timeout=5,
            health_check_interval=30,
        )
    return _redis_client


def task_key(task_id: str) -> str:
    return f"{TASK_KEY_PREFIX}:{task_id}"


def load_task_state(task_id: str) -> Optional[Dict[str, Any]]:
    raw = get_redis().get(task_key(task_id))
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        logger.error("corrupted task state for %s", task_id)
        return None


def save_task_state(task_id: str, state: Dict[str, Any]) -> None:
    state["task_id"] = task_id
    state["updated_at"] = utcnow_iso()
    get_redis().set(task_key(task_id), json.dumps(state, ensure_ascii=False), ex=RESULT_TTL)


def update_task_state(
    task_id: str,
    patch: Optional[Dict[str, Any]] = None,
    event: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Read-modify-write task state with optimistic locking (WATCH/MULTI)."""
    client = get_redis()
    key = task_key(task_id)
    state: Dict[str, Any] = {"task_id": task_id}
    for _ in range(5):
        with client.pipeline() as pipe:
            try:
                pipe.watch(key)
                raw = pipe.get(key)
                state = json.loads(raw) if raw else {"task_id": task_id}
                if patch:
                    state.update(patch)
                if event:
                    events = list(state.get("events") or [])
                    events.append(event)
                    state["events"] = events[-100:]
                state["task_id"] = task_id
                state["updated_at"] = utcnow_iso()
                pipe.multi()
                pipe.set(key, json.dumps(state, ensure_ascii=False), ex=RESULT_TTL)
                pipe.execute()
                return state
            except redis.WatchError:
                time.sleep(0.05)
    logger.warning("state update raced for %s, forcing write", task_id)
    save_task_state(task_id, state)
    return state


# --------------------------------------------------------------------------- #
# helpers: logging (stdout + jsonl file, per task file AND unified file)
# --------------------------------------------------------------------------- #
def log_event(task_id: str, event: str, level: str = "INFO", **fields: Any) -> Dict[str, Any]:
    record: Dict[str, Any] = {
        "ts": utcnow_iso(),
        "level": level.upper(),
        "event": event,
        "task_id": task_id,
        "pid": os.getpid(),
        "host": socket.gethostname(),
    }
    record.update(fields)

    line = json.dumps(record, ensure_ascii=False, default=str)
    try:
        ensure_log_dirs()
        with open(UNIFIED_LOG_FILE, "a", encoding="utf-8") as unified:
            unified.write(line + "\n")
        with open(TASK_LOG_DIR / f"{task_id}.jsonl", "a", encoding="utf-8") as per_task:
            per_task.write(line + "\n")
    except OSError as exc:  # logging must never break task execution
        logger.error("failed to write task log for %s: %s", task_id, exc)

    level_no = getattr(logging, record["level"], logging.INFO)
    logger.log(level_no, "%s %s %s", task_id, event, line)
    return record


def write_output_file(task_id: str, stream: str, content: str) -> Optional[str]:
    """Persist the full stdout/stderr of a run next to the per-task jsonl log."""
    try:
        ensure_log_dirs()
        path = TASK_LOG_DIR / f"{task_id}.{stream}.txt"
        path.write_text(content or "", encoding="utf-8")
        return str(path)
    except OSError as exc:
        logger.error("failed to write %s file for %s: %s", stream, task_id, exc)
        return None


def _truncate(text: str, limit: int = MAX_OUTPUT_CHARS) -> str:
    text = text or ""
    if len(text) <= limit:
        return text
    return text[:limit] + f"\n...[truncated, total {len(text)} chars]"


# --------------------------------------------------------------------------- #
# Celery app
# --------------------------------------------------------------------------- #
celery_app = Celery(
    "myflicker_gateway",
    broker=CELERY_BROKER_URL,
    backend=CELERY_RESULT_BACKEND,
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,  # never prefetch: keep the queue strictly FIFO
    worker_concurrency=1,  # hint only, CLI flag --concurrency=1 is authoritative
    broker_connection_retry_on_startup=True,
    result_expires=RESULT_TTL,
    task_default_queue=CELERY_QUEUE,
    task_soft_time_limit=int(MAX_TIMEOUT) + 30,
    task_time_limit=int(MAX_TIMEOUT) + 120,
)


# --------------------------------------------------------------------------- #
# subprocess helpers
# --------------------------------------------------------------------------- #
def build_child_env(task_id: str, env_extra: Optional[Dict[str, Any]]) -> Dict[str, str]:
    """Inherit the worker env, then layer .env EXTRA_ENV, then per-request env."""
    env = os.environ.copy()
    for key, value in EXTRA_ENV.items():
        env[key] = str(value)
    if env_extra:
        for key, value in env_extra.items():
            env[str(key)] = str(value)
    env.setdefault("PYTHONUNBUFFERED", "1")
    env.setdefault("MYFLICKER_TASK_ID", task_id)
    return env


def _signal_process_group(proc: subprocess.Popen, sig: int) -> None:
    try:
        if os.name == "posix":
            os.killpg(os.getpgid(proc.pid), sig)
        elif sig == signal.SIGTERM:
            proc.terminate()
        else:
            proc.kill()
    except (ProcessLookupError, PermissionError):
        pass


def terminate_process(proc: subprocess.Popen, grace_seconds: float = 5.0) -> None:
    """SIGTERM the whole process group, wait, then SIGKILL if still alive."""
    if proc.poll() is not None:
        return
    _signal_process_group(proc, signal.SIGTERM)
    deadline = time.monotonic() + grace_seconds
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            return
        time.sleep(0.1)
    _signal_process_group(proc, signal.SIGKILL)


# --------------------------------------------------------------------------- #
# the only task that touches myflicker
# --------------------------------------------------------------------------- #
@celery_app.task(bind=True, name="myflicker.run", max_retries=0)
def run_myflicker(
    self,
    task_id: str,
    cli_args: Optional[List[str]] = None,
    timeout: Optional[float] = None,
    cwd: Optional[str] = None,
    env_extra: Optional[Dict[str, Any]] = None,
    source: Optional[str] = None,
    submitted_at: Optional[str] = None,
) -> Dict[str, Any]:
    args = [str(arg) for arg in (cli_args or [])]
    command = [MYFLICKER_BIN] + args
    cmdline = shlex.join(command)
    run_cwd = cwd or MYFLICKER_CWD
    try:
        timeout_sec = float(timeout) if timeout else DEFAULT_TIMEOUT
    except (TypeError, ValueError):
        timeout_sec = DEFAULT_TIMEOUT
    if timeout_sec <= 0:
        timeout_sec = DEFAULT_TIMEOUT

    started_at = utcnow_iso()
    update_task_state(
        task_id,
        {
            "status": "running",
            "started_at": started_at,
            "celery_task_id": self.request.id,
            "worker": socket.gethostname(),
            "cmd": command,
            "cmdline": cmdline,
            "cwd": run_cwd,
            "timeout": timeout_sec,
            "source": source,
            "submitted_at": submitted_at,
        },
    )
    log_event(
        task_id,
        "task.started",
        celery_task_id=self.request.id,
        command=command,
        cmdline=cmdline,
        cwd=run_cwd,
        timeout=timeout_sec,
    )

    stdout = ""
    stderr = ""
    returncode: Optional[int] = None
    timed_out = False
    error: Optional[str] = None
    duration_ms: Optional[int] = None
    pid: Optional[int] = None

    if run_cwd and not Path(run_cwd).is_dir():
        error = f"cwd not found: {run_cwd}"
        log_event(task_id, "process.spawn_failed", level="ERROR", error=error, cwd=run_cwd)
    else:
        child_env = build_child_env(task_id, env_extra)
        proc: Optional[subprocess.Popen] = None
        try:
            proc = subprocess.Popen(
                command,
                cwd=run_cwd,
                env=child_env,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
                start_new_session=True,
            )
        except FileNotFoundError:
            error = f"executable not found: {MYFLICKER_BIN} (check MYFLICKER_BIN)"
            log_event(task_id, "process.spawn_failed", level="ERROR", error=error)
        except PermissionError:
            error = f"executable not permitted: {MYFLICKER_BIN}"
            log_event(task_id, "process.spawn_failed", level="ERROR", error=error)
        except OSError as exc:
            error = f"spawn failed: {exc}"
            log_event(task_id, "process.spawn_failed", level="ERROR", error=error)

        if proc is not None:
            pid = proc.pid
            update_task_state(task_id, {"pid": pid})
            log_event(task_id, "process.started", pid=pid, command=command, cwd=run_cwd)

            clock = time.monotonic()
            try:
                stdout, stderr = proc.communicate(timeout=timeout_sec)
                timed_out = False
            except subprocess.TimeoutExpired as exc:
                timed_out = True
                stdout = exc.stdout or ""
                stderr = exc.stderr or ""
                if isinstance(stdout, bytes):
                    stdout = stdout.decode("utf-8", "replace")
                if isinstance(stderr, bytes):
                    stderr = stderr.decode("utf-8", "replace")
                log_event(
                    task_id,
                    "process.timeout",
                    level="ERROR",
                    pid=pid,
                    timeout=timeout_sec,
                    reason="subprocess.TimeoutExpired",
                )
                terminate_process(proc)
                try:
                    tail_out, tail_err = proc.communicate(timeout=10)
                    stdout = (stdout or "") + (tail_out or "")
                    stderr = (stderr or "") + (tail_err or "")
                except subprocess.TimeoutExpired:
                    stderr = (stderr or "") + "\n[gateway] process did not die after SIGKILL"
            except Exception as exc:  # noqa: BLE001 - never let a task die silently
                error = f"unexpected subprocess error: {exc}"
                log_event(task_id, "process.error", level="ERROR", pid=pid, error=error)
                terminate_process(proc)

            returncode = proc.returncode
            duration_ms = int((time.monotonic() - clock) * 1000)

            stdout_path = write_output_file(task_id, "stdout", stdout)
            stderr_path = write_output_file(task_id, "stderr", stderr)

            log_event(
                task_id,
                "process.stdout",
                pid=pid,
                bytes=len(stdout or ""),
                content=_truncate(stdout),
                file=stdout_path,
            )
            log_event(
                task_id,
                "process.stderr",
                level="WARNING" if stderr else "INFO",
                pid=pid,
                bytes=len(stderr or ""),
                content=_truncate(stderr),
                file=stderr_path,
            )

    finished_at = utcnow_iso()
    if timed_out:
        status = "failure"
        error = error or f"timeout after {timeout_sec}s"
    elif error is not None:
        status = "failure"
    elif returncode == 0:
        status = "success"
    else:
        status = "failure"
        error = error or f"myflicker exited with returncode {returncode}"

    result: Dict[str, Any] = {
        "task_id": task_id,
        "status": status,
        "returncode": returncode,
        "timed_out": timed_out,
        "error": error,
        "duration_ms": duration_ms,
        "started_at": started_at,
        "finished_at": finished_at,
        "cmd": command,
        "cmdline": cmdline,
        "cwd": run_cwd,
        "timeout": timeout_sec,
        "pid": pid,
        "args": args,
        "source": source,
        "submitted_at": submitted_at,
        "stdout": _truncate(stdout),
        "stderr": _truncate(stderr),
    }

    event = log_event(
        task_id,
        "task.finished",
        level="INFO" if status == "success" else "ERROR",
        **{
            k: result[k]
            for k in (
                "status",
                "returncode",
                "timed_out",
                "duration_ms",
                "error",
                "cmdline",
                "cwd",
            )
        },
    )

    update_task_state(task_id, result, event=event)
    return result
