"""FastAPI gateway for the private myflicker CLI (async, queue-backed).

Endpoints (all require the ``X-API-Key`` header):
    POST /api/myflicker/submit              -> 202 {task_id, status: "pending"}
    GET  /api/myflicker/result/{task_id}    -> pending | running | success | failure
    GET  /api/myflicker/health              -> gateway + redis + broker snapshot

The gateway never executes myflicker itself. It only enqueues a Celery task;
the worker (started with --concurrency=1) owns every subprocess call.
"""

from __future__ import annotations

import logging
import os
import re
import secrets
import shlex
import sys
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

from celery_tasks import (
    CELERY_QUEUE,
    DEFAULT_TIMEOUT,
    EXTRA_ENV,
    LOG_DIR,
    MAX_TIMEOUT,
    MYFLICKER_BIN,
    MYFLICKER_CWD,
    RESULT_TTL,
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

if not API_KEY:
    raise RuntimeError(
        "API_KEY is not set. Put API_KEY=<strong-random-string> into .env "
        "and restart the gateway."
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


@app.on_event("startup")
def _on_startup() -> None:
    ensure_log_dirs()
    logger.info(
        "gateway starting | bin=%s | cwd=%s | queue=%s | redis=%s | logs=%s",
        MYFLICKER_BIN,
        MYFLICKER_CWD,
        CELERY_QUEUE,
        os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0"),
        LOG_DIR,
    )


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
) -> str:
    if not x_api_key:
        raise HTTPException(
            status_code=401,
            detail={
                "code": "missing_api_key",
                "message": "X-API-Key header is required",
            },
            headers={"WWW-Authenticate": "X-API-Key"},
        )
    if not secrets.compare_digest(x_api_key, API_KEY):
        raise HTTPException(
            status_code=401,
            detail={
                "code": "invalid_api_key",
                "message": "X-API-Key is invalid",
            },
            headers={"WWW-Authenticate": "X-API-Key"},
        )
    return x_api_key


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
    _: str = Depends(verify_api_key),
) -> JSONResponse:
    args = _normalize_args(body.args)
    timeout = _normalize_timeout(body.timeout)
    env_extra = _normalize_env(body.env)

    cwd = (body.cwd or "").strip() or MYFLICKER_CWD
    if cwd and not Path(cwd).expanduser().is_dir():
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
            queue=CELERY_QUEUE,
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

    log_event(task_id, "task.enqueued", queue=CELERY_QUEUE, celery_task_id=task_id)
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
    _: str = Depends(verify_api_key),
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
        "error": state.get("error"),
        "finished": status_value in ("success", "failure"),
    }

    if status_value in ("success", "failure"):
        payload["stdout"] = state.get("stdout", "")
        payload["stderr"] = state.get("stderr", "")
    else:
        payload["poll_hint_ms"] = POLL_HINT_MS

    if include_events:
        payload["events"] = state.get("events", [])

    return JSONResponse(status_code=200, content=payload)


@app.get("/api/myflicker/health")
async def health(_: str = Depends(verify_api_key)) -> JSONResponse:
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
        "myflicker_bin": MYFLICKER_BIN,
        "myflicker_cwd": MYFLICKER_CWD,
        "default_timeout": DEFAULT_TIMEOUT,
        "max_timeout": MAX_TIMEOUT,
        "extra_env_keys": sorted(EXTRA_ENV.keys()),
        "log_dir": str(LOG_DIR),
        "result_ttl": RESULT_TTL,
        "serial_execution": {
            "concurrency": 1,
            "worker_command": "celery -A celery_tasks.celery_app worker --concurrency=1 --loglevel=info",
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
