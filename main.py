"""FastAPI gateway for the private myflicker CLI (async, queue-backed).

Endpoints (all require the ``X-API-Key`` header):
    POST /api/myflicker/submit                 -> 202 {task_id, status: "pending"}
    GET  /api/myflicker/result/{task_id}       -> pending|running|success|failure|canceled
    POST /api/myflicker/tasks/{task_id}/cancel -> cancel a task that is still pending
    GET  /api/myflicker/tasks                  -> queue snapshot (admin key)
    GET  /api/myflicker/health                 -> gateway + redis + broker snapshot (admin key)

LAN exposure controls: X-API-Key, ALLOWED_CIDRS allowlist, per-key+IP rate limit,
queue-depth backpressure and an optional allowed-subcommand regex.
The gateway never executes myflicker itself; the worker (--concurrency=1) does.
"""

from __future__ import annotations

import ipaddress
import json
import logging
import os
import re
import secrets
import shlex
import socket
import sys
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from celery.result import AsyncResult
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException

from identity import Identity, load_identities, resolve_cwd, resolve_key, sandbox_applies_to, within, workspace_root
from openai_api import router as openai_router
from celery_tasks import (
    CELERY_QUEUE,
    DEFAULT_TIMEOUT,
    EXTRA_ENV,
    LOG_DIR,
    MAX_TIMEOUT,
    MYFLICKER_BIN,
    MYFLICKER_CWD,
    RESULT_TTL,
    TASK_KEY_PREFIX,
    broker_queue_depth,
    celery_app,
    ensure_log_dirs,
    get_redis,
    load_task_state,
    log_event,
    run_myflicker,
    save_task_state,
    update_task_state,
    utcnow_iso,
)

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(dotenv_path=BASE_DIR / ".env")

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
# config
# --------------------------------------------------------------------------- #
API_KEY: str = (os.getenv("API_KEY") or "").strip()
API_HOST: str = os.getenv("API_HOST", "0.0.0.0")
API_PORT: int = int(os.getenv("API_PORT", "8000"))
MAX_ARGS: int = int(os.getenv("MAX_ARGS", "200"))
MAX_ARG_LEN: int = int(os.getenv("MAX_ARG_LEN", "4096"))
POLL_HINT_MS: int = int(os.getenv("POLL_HINT_MS", "1000"))
TASK_ID_RE = re.compile(r"^[0-9a-f]{32}$")

# task key (submit/result/cancel) vs admin key (health/tasks list)
ADMIN_API_KEY: str = (os.getenv("ADMIN_API_KEY") or "").strip()
ALLOWED_CIDRS_RAW: str = os.getenv("ALLOWED_CIDRS", "").strip()
RATE_LIMIT_PER_MIN: int = int(os.getenv("RATE_LIMIT_PER_MIN", "0"))
MAX_QUEUE_DEPTH: int = int(os.getenv("MAX_QUEUE_DEPTH", "20"))
ALLOWED_ARGS_REGEX: str = os.getenv("ALLOWED_ARGS_REGEX", "").strip()
TERMINAL_STATUSES = ("success", "failure", "canceled")


def _parse_cidrs(raw: str) -> List[ipaddress._BaseNetwork]:
    networks: List[ipaddress._BaseNetwork] = []
    for item in [chunk.strip() for chunk in raw.split(",") if chunk.strip()]:
        try:
            networks.append(ipaddress.ip_network(item, strict=False))
        except ValueError:
            logger.warning("ignoring invalid ALLOWED_CIDRS entry: %s", item)
    return networks


ALLOWED_NETWORKS = _parse_cidrs(ALLOWED_CIDRS_RAW)
ALLOWED_ARGS_PATTERN = re.compile(ALLOWED_ARGS_REGEX) if ALLOWED_ARGS_REGEX else None

if not load_identities():
    raise RuntimeError(
        "No API key configured. Put API_KEY=<strong-random-string> (single user) "
        "or API_KEYS=alice:<key>,bob:<key> (shared, per-user workspace) into .env."
    )


# --------------------------------------------------------------------------- #
# app
# --------------------------------------------------------------------------- #
app = FastAPI(
    title="myflicker API Gateway",
    version="1.0.0",
    description=(
        "Async HTTP facade over the private myflicker CLI. Submit a task, poll "
        "the result. myflicker runs strictly serial in a single Celery worker."
    ),
)


app.include_router(openai_router)


@app.on_event("startup")
def _on_startup() -> None:
    ensure_log_dirs()
    logger.info(
        "gateway starting | bin=%s | cwd=%s | queue=%s | redis=%s | logs=%s | bind=%s:%s | allowed_cidrs=%s | rate_limit=%s/min | max_queue_depth=%s",
        MYFLICKER_BIN,
        MYFLICKER_CWD,
        CELERY_QUEUE,
        os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0"),
        LOG_DIR,
        API_HOST,
        API_PORT,
        [str(net) for net in ALLOWED_NETWORKS] or "any",
        RATE_LIMIT_PER_MIN or "off",
        MAX_QUEUE_DEPTH or "off",
    )
    if API_HOST not in ("127.0.0.1", "localhost", "::1"):
        logger.warning(
            "gateway is bound to %s: LAN clients can reach it (X-API-Key required)",
            API_HOST,
        )


# --------------------------------------------------------------------------- #
# network guards: CIDR allowlist + simple per-key/IP rate limit
# --------------------------------------------------------------------------- #
def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _is_allowed_ip(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    if addr.is_loopback:
        return True
    if not ALLOWED_NETWORKS:
        return True
    return any(addr in network for network in ALLOWED_NETWORKS)


def _rate_limit(ip: str, api_key: str) -> tuple[bool, int, int]:
    """Fixed-window counter in redis. Fails open if redis is unavailable."""
    import hashlib

    window = int(time.time() // 60)
    fingerprint = hashlib.sha256(f"{ip}:{api_key}".encode()).hexdigest()[:16]
    key = f"{TASK_KEY_PREFIX}:rate:{window}:{fingerprint}"
    try:
        client = get_redis()
        count = int(client.incr(key))
        if count == 1:
            client.expire(key, 120)
        retry_after = 60 - int(time.time() % 60)
        return count > RATE_LIMIT_PER_MIN, max(0, RATE_LIMIT_PER_MIN - count), retry_after
    except Exception:  # noqa: BLE001 - availability over strictness
        return False, RATE_LIMIT_PER_MIN, 0


@app.middleware("http")
async def _lan_guard(request: Request, call_next):
    if request.url.path.startswith("/api/"):
        ip = _client_ip(request)
        if not _is_allowed_ip(ip):
            return JSONResponse(
                status_code=403,
                content=_error_payload(
                    "ip_not_allowed",
                    f"client ip {ip} is not in ALLOWED_CIDRS",
                    client_ip=ip,
                    allowed_cidrs=[str(net) for net in ALLOWED_NETWORKS],
                ),
            )
        if RATE_LIMIT_PER_MIN > 0:
            limited, remaining, retry_after = _rate_limit(
                ip, request.headers.get("x-api-key", "")
            )
            if limited:
                return JSONResponse(
                    status_code=429,
                    content=_error_payload(
                        "rate_limited",
                        f"more than {RATE_LIMIT_PER_MIN} requests/min",
                        client_ip=ip,
                        retry_after_seconds=retry_after,
                    ),
                    headers={"Retry-After": str(retry_after)},
                )
    return await call_next(request)


def queue_depth() -> Optional[int]:
    """Depth of the default queue; identity-scoped depth is reported per request."""
    return broker_queue_depth(CELERY_QUEUE)


def identity_queue_depth(identity: Identity) -> Optional[int]:
    return broker_queue_depth(identity.queue)


def lan_urls(port: int) -> List[str]:
    candidates: set[str] = set()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            candidates.add(info[4][0])
    except OSError:
        pass
    try:
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        probe.connect(("8.8.8.8", 80))
        candidates.add(probe.getsockname()[0])
        probe.close()
    except OSError:
        pass
    urls = sorted(
        f"http://{ip}:{port}" for ip in candidates if not ip.startswith("127.")
    )
    host = socket.gethostname().split(".")[0]
    if host:
        urls.append(f"http://{host}.local:{port}")
    return urls


# --------------------------------------------------------------------------- #
# schemas
# --------------------------------------------------------------------------- #
class SubmitRequest(BaseModel):
    args: List[str] = []
    timeout: Optional[float] = None
    cwd: Optional[str] = None
    env: Optional[Dict[str, str]] = None
    source: Optional[str] = None


def _error_payload(code: str, message: str, **extra: Any) -> Dict[str, Any]:
    payload: Dict[str, Any] = {"ok": False, "error": {"code": code, "message": message}}
    payload["error"].update(extra)
    return payload


@app.exception_handler(StarletteHTTPException)
async def _http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    detail = exc.detail
    if isinstance(detail, dict) and "code" in detail:
        payload = {"ok": False, "error": detail}
    else:
        payload = _error_payload("http_error", str(detail))
    return JSONResponse(status_code=exc.status_code, content=payload)


@app.exception_handler(RequestValidationError)
async def _validation_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content=_error_payload(
            "validation_error",
            "request body failed validation",
            details=exc.errors(),
        ),
    )


@app.exception_handler(Exception)
async def _unhandled_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content=_error_payload("internal_error", f"{type(exc).__name__}: {exc}"),
    )


# --------------------------------------------------------------------------- #
# auth
# --------------------------------------------------------------------------- #
async def verify_api_key(
    x_api_key: Optional[str] = Header(default=None, alias="X-API-Key"),
) -> Identity:
    if not x_api_key:
        raise HTTPException(
            status_code=401,
            detail={"code": "missing_api_key", "message": "X-API-Key header is required"},
            headers={"WWW-Authenticate": "X-API-Key"},
        )
    identity = resolve_key(x_api_key)
    if identity is None:
        raise HTTPException(
            status_code=401,
            detail={"code": "invalid_api_key", "message": "X-API-Key is invalid"},
            headers={"WWW-Authenticate": "X-API-Key"},
        )
    return identity


async def verify_admin_key(
    x_api_key: Optional[str] = Header(default=None, alias="X-API-Key"),
) -> Identity:
    """ADMIN_API_KEY when configured, otherwise the default (local) key."""
    if not x_api_key:
        raise HTTPException(
            status_code=401,
            detail={"code": "missing_api_key", "message": "X-API-Key header is required"},
            headers={"WWW-Authenticate": "X-API-Key"},
        )
    identity = resolve_key(x_api_key)
    if identity is None:
        raise HTTPException(
            status_code=401,
            detail={"code": "invalid_api_key", "message": "admin key required"},
            headers={"WWW-Authenticate": "X-API-Key"},
        )
    if ADMIN_API_KEY and not identity.is_admin:
        raise HTTPException(
            status_code=401,
            detail={"code": "invalid_api_key", "message": "admin key required"},
            headers={"WWW-Authenticate": "X-API-Key"},
        )
    return identity


def _assert_owner(identity: Identity, state: Optional[Dict[str, Any]], task_id: str) -> None:
    """Hide other callers' tasks: same response as a missing task."""
    if not state:
        raise HTTPException(404, {"code": "task_not_found", "message": f"unknown task: {task_id}"})
    owner = state.get("owner")
    if not identity.is_admin and owner != identity.label:
        raise HTTPException(404, {"code": "task_not_found", "message": f"unknown task: {task_id}"})


# --------------------------------------------------------------------------- #
# validation helpers
# --------------------------------------------------------------------------- #
def _normalize_args(raw: Optional[List[str]]) -> List[str]:
    args = raw or []
    if not isinstance(args, list):
        raise HTTPException(
            400, {"code": "invalid_args", "message": "args must be a JSON array of strings"}
        )
    if len(args) > MAX_ARGS:
        raise HTTPException(
            400,
            {"code": "too_many_args", "message": f"args length must be <= {MAX_ARGS}"},
        )
    cleaned: List[str] = []
    for index, item in enumerate(args):
        if not isinstance(item, str):
            raise HTTPException(
                400,
                {
                    "code": "invalid_args",
                    "message": f"args[{index}] must be a string, got {type(item).__name__}",
                },
            )
        if "\x00" in item:
            raise HTTPException(
                400, {"code": "invalid_args", "message": f"args[{index}] contains NUL byte"}
            )
        if len(item) > MAX_ARG_LEN:
            raise HTTPException(
                400,
                {
                    "code": "invalid_args",
                    "message": f"args[{index}] longer than {MAX_ARG_LEN} chars",
                },
            )
        cleaned.append(item)
    return cleaned


def _normalize_timeout(raw: Optional[float]) -> Optional[float]:
    if raw is None:
        return None
    try:
        timeout = float(raw)
    except (TypeError, ValueError):
        raise HTTPException(
            400, {"code": "invalid_timeout", "message": "timeout must be a number (seconds)"}
        )
    if timeout <= 0:
        raise HTTPException(
            400, {"code": "invalid_timeout", "message": "timeout must be > 0"}
        )
    if timeout > MAX_TIMEOUT:
        raise HTTPException(
            400,
            {
                "code": "invalid_timeout",
                "message": f"timeout must be <= MAX_TIMEOUT ({MAX_TIMEOUT}s)",
            },
        )
    return timeout


def _normalize_env(raw: Optional[Dict[str, str]]) -> Dict[str, str]:
    if not raw:
        return {}
    if not isinstance(raw, dict):
        raise HTTPException(
            400, {"code": "invalid_env", "message": "env must be a JSON object"}
        )
    for key, value in raw.items():
        if not isinstance(key, str) or not isinstance(value, str):
            raise HTTPException(
                400,
                {
                    "code": "invalid_env",
                    "message": "env keys and values must be strings",
                },
            )
        if "\x00" in key or "\x00" in value or "=" in key:
            raise HTTPException(
                400, {"code": "invalid_env", "message": f"illegal env entry: {key!r}"}
            )
    return {str(k): str(v) for k, v in raw.items()}


# --------------------------------------------------------------------------- #
# endpoints
# --------------------------------------------------------------------------- #
@app.post("/api/myflicker/submit", status_code=202)
async def submit_task(
    body: SubmitRequest,
    request: Request,
    identity: Identity = Depends(verify_api_key),
) -> JSONResponse:
    args = _normalize_args(body.args)
    timeout = _normalize_timeout(body.timeout)
    env_extra = _normalize_env(body.env)

    if ALLOWED_ARGS_PATTERN is not None:
        joined = " ".join(args)
        if not ALLOWED_ARGS_PATTERN.search(joined):
            raise HTTPException(
                400,
                {
                    "code": "arg_not_allowed",
                    "message": "args rejected by ALLOWED_ARGS_REGEX",
                    "allowed_args_regex": ALLOWED_ARGS_REGEX,
                },
            )

    depth = identity_queue_depth(identity)
    if MAX_QUEUE_DEPTH and depth is not None and depth >= MAX_QUEUE_DEPTH:
        raise HTTPException(
            429,
            {
                "code": "queue_full",
                "message": f"your queue has {depth} waiting tasks (limit {MAX_QUEUE_DEPTH})",
                "queue_depth": depth,
                "max_queue_depth": MAX_QUEUE_DEPTH,
            },
            headers={"Retry-After": "10"},
        )

    client_ip_for_cwd = request.client.host if request.client else "unknown"
    try:
        cwd_path = resolve_cwd(identity, body.cwd, client_ip_for_cwd)
    except PermissionError as exc:
        raise HTTPException(
            403,
            {
                "code": "cwd_outside_workspace",
                "message": str(exc),
                "workspace": str(identity.ensure_workspace()),
            },
        )
    cwd = str(cwd_path)
    if not cwd_path.is_dir():
        raise HTTPException(
            400, {"code": "invalid_cwd", "message": f"cwd does not exist: {cwd}"}
        )

    source = (body.source or "api").strip()[:64]
    client_ip = request.client.host if request.client else "unknown"
    user_agent = (request.headers.get("user-agent") or "")[:160]
    effective_timeout = timeout or DEFAULT_TIMEOUT

    task_id = uuid.uuid4().hex
    submitted_at = utcnow_iso()
    command = [MYFLICKER_BIN] + args

    initial_state: Dict[str, Any] = {
        "task_id": task_id,
        "status": "pending",
        "args": args,
        "cmd": command,
        "cmdline": shlex.join(command),
        "cwd": cwd,
        "timeout": effective_timeout,
        "source": source,
        "owner": identity.label,
        "namespace": identity.namespace,
        "client_ip": client_ip,
        "user_agent": user_agent,
        "submitted_at": submitted_at,
        "started_at": None,
        "finished_at": None,
        "returncode": None,
        "timed_out": False,
        "duration_ms": None,
        "stdout": "",
        "stderr": "",
        "error": None,
        "events": [],
    }
    try:
        save_task_state(task_id, initial_state)
    except Exception as exc:  # redis down
        logger.exception("failed to persist task %s", task_id)
        raise HTTPException(
            503, {"code": "state_store_unavailable", "message": f"redis unavailable: {exc}"}
        )

    log_event(
        task_id,
        "task.submitted",
        args=args,
        source=source,
        client_ip=client_ip,
        user_agent=user_agent,
        timeout=effective_timeout,
        cwd=cwd,
    )

    try:
        run_myflicker.apply_async(
            kwargs={
                "task_id": task_id,
                "cli_args": args,
                "timeout": timeout,
                "cwd": cwd,
                "env_extra": env_extra,
                "source": source,
                "submitted_at": submitted_at,
            },
            task_id=task_id,
            queue=identity.queue,
        )
    except Exception as exc:
        logger.exception("failed to enqueue task %s", task_id)
        failed_at = utcnow_iso()
        event = log_event(
            task_id, "task.enqueue_failed", level="ERROR", error=f"{type(exc).__name__}: {exc}"
        )
        update_task_state(
            task_id,
            {
                "status": "failure",
                "finished_at": failed_at,
                "error": f"enqueue failed: {type(exc).__name__}: {exc}",
            },
            event=event,
        )
        raise HTTPException(
            503, {"code": "enqueue_failed", "message": f"could not enqueue task: {exc}"}
        )

    log_event(task_id, "task.enqueued", queue=identity.queue, celery_task_id=task_id)
    return JSONResponse(
        status_code=202,
        content={
            "ok": True,
            "task_id": task_id,
            "status": "pending",
            "submitted_at": submitted_at,
            "args": args,
            "cmdline": shlex.join(command),
            "timeout": effective_timeout,
            "cwd": cwd,
            "result_url": f"/api/myflicker/result/{task_id}",
            "poll_hint_ms": POLL_HINT_MS,
        },
    )


@app.get("/api/myflicker/result/{task_id}")
async def get_result(
    task_id: str,
    include_events: bool = False,
    identity: Identity = Depends(verify_api_key),
) -> JSONResponse:
    if not TASK_ID_RE.match(task_id):
        raise HTTPException(
            400,
            {
                "code": "invalid_task_id",
                "message": "task_id must be 32 lowercase hex chars",
            },
        )

    state = load_task_state(task_id)
    _assert_owner(identity, state, task_id)
    if state is None:
        # redis state expired/absent: only trust the celery backend for
        # terminal states, otherwise the id is simply unknown to us.
        async_result = AsyncResult(task_id, app=celery_app)
        if async_result.state == "FAILURE":
            return JSONResponse(
                status_code=200,
                content={
                    "ok": True,
                    "task_id": task_id,
                    "status": "failure",
                    "returncode": None,
                    "timed_out": False,
                    "error": f"celery task failed: {async_result.result}",
                    "stdout": "",
                    "stderr": "",
                    "finished": True,
                },
            )
        raise HTTPException(
            404,
            {
                "code": "task_not_found",
                "message": f"unknown or expired task_id: {task_id}",
            },
        )

    status_value = state.get("status", "pending")
    payload: Dict[str, Any] = {
        "ok": True,
        "task_id": task_id,
        "status": status_value,
        "submitted_at": state.get("submitted_at"),
        "started_at": state.get("started_at"),
        "finished_at": state.get("finished_at"),
        "duration_ms": state.get("duration_ms"),
        "returncode": state.get("returncode"),
        "timed_out": bool(state.get("timed_out", False)),
        "cmd": state.get("cmd"),
        "cmdline": state.get("cmdline"),
        "cwd": state.get("cwd"),
        "timeout": state.get("timeout"),
        "source": state.get("source"),
        "client_ip": state.get("client_ip"),
        "error": state.get("error"),
        "finished": status_value in TERMINAL_STATUSES,
    }

    if status_value in TERMINAL_STATUSES:
        payload["stdout"] = state.get("stdout", "")
        payload["stderr"] = state.get("stderr", "")
    else:
        payload["poll_hint_ms"] = POLL_HINT_MS

    if include_events:
        payload["events"] = state.get("events", [])

    return JSONResponse(status_code=200, content=payload)


@app.get("/api/myflicker/tasks")
async def list_tasks(
    limit: int = 20,
    status: Optional[str] = None,
    identity: Identity = Depends(verify_admin_key),
) -> JSONResponse:
    limit = max(1, min(int(limit), 100))
    try:
        client = get_redis()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(503, {"code": "state_store_unavailable", "message": str(exc)})

    tasks: List[Dict[str, Any]] = []
    cursor = 0
    scanned = 0
    pattern = f"{TASK_KEY_PREFIX}:*"
    while True:
        cursor, keys = client.scan(cursor=cursor, match=pattern, count=200)
        for key in keys:
            suffix = key.rsplit(":", 1)[-1]
            if not TASK_ID_RE.match(suffix):
                continue
            raw = client.get(key)
            if not raw:
                continue
            try:
                item = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if status and item.get("status") != status:
                continue
            owner = item.get("owner")
            # tasks without an owner predate multi-tenant support: admin only
            if not identity.is_admin and owner != identity.label:
                continue
            tasks.append(item)
        scanned += len(keys)
        if cursor == 0 or scanned >= 500:
            break

    tasks.sort(key=lambda item: item.get("submitted_at") or "", reverse=True)
    selected = tasks[:limit]
    return JSONResponse(
        status_code=200,
        content={
            "ok": True,
            "queue": CELERY_QUEUE,
            "queue_depth": queue_depth(),
            "max_queue_depth": MAX_QUEUE_DEPTH,
            "total_scanned": scanned,
            "count": len(selected),
            "tasks": [
                {
                    "task_id": item.get("task_id"),
                    "status": item.get("status"),
                    "args": item.get("args"),
                    "source": item.get("source"),
                    "owner": item.get("owner"),
                    "client_ip": item.get("client_ip"),
                    "submitted_at": item.get("submitted_at"),
                    "started_at": item.get("started_at"),
                    "finished_at": item.get("finished_at"),
                    "duration_ms": item.get("duration_ms"),
                    "returncode": item.get("returncode"),
                    "timed_out": item.get("timed_out", False),
                    "error": item.get("error"),
                }
                for item in selected
            ],
        },
    )


@app.post("/api/myflicker/tasks/{task_id}/cancel")
async def cancel_task(task_id: str, identity: Identity = Depends(verify_api_key)) -> JSONResponse:
    if not TASK_ID_RE.match(task_id):
        raise HTTPException(
            400, {"code": "invalid_task_id", "message": "task_id must be 32 lowercase hex chars"}
        )
    state = load_task_state(task_id)
    _assert_owner(identity, state, task_id)
    current = state.get("status")
    if current != "pending":
        raise HTTPException(
            409,
            {
                "code": "not_cancelable",
                "message": f"only pending tasks can be canceled (current status: {current})",
                "status": current,
            },
        )
    try:
        celery_app.control.revoke(task_id, terminate=False)
    except Exception as exc:  # noqa: BLE001 - still mark it canceled locally
        logger.warning("revoke failed for %s: %s", task_id, exc)
    event = log_event(task_id, "task.canceled", reason="operator canceled via API")
    update_task_state(
        task_id,
        {
            "status": "canceled",
            "finished_at": utcnow_iso(),
            "error": "canceled by operator",
        },
        event=event,
    )
    return JSONResponse(
        status_code=200,
        content={"ok": True, "task_id": task_id, "status": "canceled"},
    )


@app.get("/api/myflicker/health")
async def health(
    request: Request,
    identity: Identity = Depends(verify_api_key),
) -> JSONResponse:
    redis_ok = False
    redis_error: Optional[str] = None
    try:
        redis_ok = bool(get_redis().ping())
    except Exception as exc:  # noqa: BLE001
        redis_error = f"{type(exc).__name__}: {exc}"

    worker_ok: Optional[bool] = None
    worker_error: Optional[str] = None
    online_workers = 0
    try:
        pings = celery_app.control.ping(timeout=1.0) or []
        online_workers = len(pings)
        worker_ok = online_workers > 0
    except Exception as exc:  # noqa: BLE001
        worker_error = f"{type(exc).__name__}: {exc}"

    payload = {
        "ok": redis_ok,
        "redis": {"ok": redis_ok, "error": redis_error},
        "worker": {"ok": worker_ok, "online_workers": online_workers, "error": worker_error},
        "queue": CELERY_QUEUE,
        "queue_depth": identity_queue_depth(identity),
        "queue": identity.queue,
        "max_queue_depth": MAX_QUEUE_DEPTH,
        "myflicker_bin": MYFLICKER_BIN,
        "myflicker_cwd": MYFLICKER_CWD,
        "default_timeout": DEFAULT_TIMEOUT,
        "max_timeout": MAX_TIMEOUT,
        "extra_env_keys": sorted(EXTRA_ENV.keys()),
        "log_dir": str(LOG_DIR),
        "result_ttl": RESULT_TTL,
        "identity": {"label": identity.label, "workspace": str(identity.ensure_workspace())},
        "workspace_root": str(workspace_root()),
        "sandbox_enforced": sandbox_applies_to(
            request.client.host if request.client else "unknown"
        ),
        "bind": f"{API_HOST}:{API_PORT}",
        "lan_enabled": API_HOST not in ("127.0.0.1", "localhost", "::1"),
        "lan_urls": lan_urls(API_PORT),
        "security": {
            "allowed_cidrs": [str(net) for net in ALLOWED_NETWORKS] or ["any"],
            "rate_limit_per_min": RATE_LIMIT_PER_MIN or None,
            "allowed_args_regex": ALLOWED_ARGS_REGEX or None,
            "admin_key_enabled": bool(ADMIN_API_KEY),
        },
        "serial_execution": {
            "concurrency": "1 per user (parallel across users)",
            "worker_command": "python worker_supervisor.py   # one --concurrency=1 worker per API key",
        },
    }
    return JSONResponse(status_code=200 if redis_ok else 503, content=payload)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=API_HOST,
        port=API_PORT,
        log_level="info",
    )
