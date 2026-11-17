"""OpenAI-compatible facade over the myflicker CLI.

Anything speaking the OpenAI Chat Completions protocol (DeepSeek Harness,
LangChain, LlamaIndex, openai-python, Cherry Studio, ...) can point its
base_url at this service:

    base_url = http://127.0.0.1:8000/v1
    api_key  = $API_KEY            # sent as "Authorization: Bearer ..."

Transport is unchanged under the hood: every request becomes one
`myflicker -q "<prompt>"` job on the same single-concurrency Celery worker,
so myflicker is still never executed in parallel.

Endpoints:
    GET  /v1/models
    POST /v1/chat/completions   (stream=true -> SSE)
"""

from __future__ import annotations

import json
import os
import secrets
import shlex
import time
import uuid
from pathlib import Path
from typing import Any, AsyncIterator, Dict, List, Optional

from dotenv import load_dotenv
from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse

from identity import Identity, resolve_cwd, resolve_key
from celery_tasks import (
    CELERY_QUEUE,
    DEFAULT_TIMEOUT,
    CELERY_QUEUE as _QUEUE,  # noqa: F401 - keep import list explicit
    MAX_TIMEOUT,
    load_task_state,
    log_event,
    publish_stream,
    read_stream,
    run_myflicker,
    save_task_state,
    utcnow_iso,
)

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(dotenv_path=BASE_DIR / ".env")

API_KEY = (os.getenv("API_KEY") or "").strip()
ADMIN_API_KEY = (os.getenv("ADMIN_API_KEY") or "").strip()
MODEL_ID = os.getenv("OPENAI_MODEL_ID", "myflicker-agent")
OWNER = os.getenv("OPENAI_MODEL_OWNER", "local-myflicker")
REQUEST_TIMEOUT = float(os.getenv("OPENAI_REQUEST_TIMEOUT", "600"))
DEFAULT_ARGS = [a for a in os.getenv("OPENAI_DEFAULT_ARGS", "-q").split() if a]
POLL_INTERVAL = float(os.getenv("OPENAI_POLL_INTERVAL", "0.25"))

router = APIRouter(tags=["openai"])


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def _error(status_code: int, message: str, code: str, err_type: str = "invalid_request_error"):
    return JSONResponse(
        status_code=status_code,
        content={"error": {"message": message, "type": err_type, "code": code, "param": None}},
    )


def _token_from_headers(authorization: Optional[str], api_key: Optional[str]) -> Optional[str]:
    if authorization:
        parts = authorization.split(None, 1)
        if len(parts) == 2 and parts[0].lower() == "bearer":
            return parts[1].strip()
        return authorization.strip()
    return api_key.strip() if api_key else None


def _identity(authorization: Optional[str], api_key: Optional[str]):
    """Return (Identity, None) or (None, error response)."""
    token = _token_from_headers(authorization, api_key)
    if not token:
        return None, _error(401, "Missing API key. Send 'Authorization: Bearer <key>'.", "missing_api_key")
    identity = resolve_key(token)
    if identity is None:
        return None, _error(401, "Incorrect API key provided.", "invalid_api_key", "authentication_error")
    return identity, None


def _content_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: List[str] = []
        for item in content:
            if isinstance(item, dict):
                if item.get("type") in (None, "text") and isinstance(item.get("text"), str):
                    parts.append(item["text"])
                elif isinstance(item.get("text"), dict) and isinstance(item["text"].get("value"), str):
                    parts.append(item["text"]["value"])
        return "".join(parts)
    return ""


def build_prompt(messages: List[Dict[str, Any]]) -> str:
    turns: List[str] = []
    for message in messages or []:
        text = _content_text(message.get("content")).strip()
        if not text:
            continue
        role = message.get("role", "user")
        turns.append(text if len(messages) == 1 else f"{role}: {text}")
    return "\n\n".join(turns).strip()


def _estimate_tokens(text: str) -> int:
    return max(1, len(text or "") // 4) if text else 0


def _submit(prompt: str, args_prefix: List[str], timeout: float, cwd: Optional[str],
            env: Optional[Dict[str, str]], source: str, identity: Identity,
            stdin_payload: Optional[str] = None) -> Dict[str, Any]:
    task_id = uuid.uuid4().hex
    submitted_at = utcnow_iso()
    command = list(args_prefix) if stdin_payload else list(args_prefix) + [prompt]
    state = {
        "task_id": task_id,
        "status": "pending",
        "args": command,
        "cmd": ["MYFLICKER_BIN", *command],
        "cmdline": shlex.join(["myflicker", *command]),
        "cwd": cwd,
        "timeout": timeout,
        "source": source,
        "owner": identity.label,
        "namespace": identity.namespace,
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
    save_task_state(task_id, state)
    log_event(task_id, "task.submitted", args=command, source=source, timeout=timeout, cwd=cwd)
    run_myflicker.apply_async(
        kwargs={
            "task_id": task_id,
            "cli_args": command,
            "timeout": timeout,
            "cwd": cwd,
            "env_extra": env or {},
            "source": source,
            "submitted_at": submitted_at,
            "stdin_payload": stdin_payload,
        },
        task_id=task_id,
        queue=identity.queue,
    )
    log_event(task_id, "task.enqueued", queue=identity.queue, celery_task_id=task_id, via="openai")
    return {"task_id": task_id, "submitted_at": submitted_at, "command": command}


def _result_payload(task_id: str, model: str, prompt: str, state: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    state = state or {}
    status = state.get("status")
    stdout = (state.get("stdout") or "").rstrip("\n")
    stderr = (state.get("stderr") or "").rstrip("\n")
    success = status == "success"
    if success:
        content = stdout
    else:
        content = stdout or (f"[myflicker failed: {state.get('error') or status}]\n{stderr}".strip())
    finish_reason = "stop" if success else "error"
    prompt_tokens = _estimate_tokens(prompt)
    completion_tokens = _estimate_tokens(content)
    return {
        "id": f"chatcmpl-{task_id[:24]}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model,
        "system_fingerprint": "myflicker-gateway",
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "logprobs": None,
                "finish_reason": finish_reason,
            }
        ],
        "usage": {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": prompt_tokens + completion_tokens,
        },
        # non-standard, ignored by OpenAI clients but invaluable when debugging
        "x_myflicker": {
            "task_id": task_id,
            "status": status,
            "returncode": state.get("returncode"),
            "timed_out": state.get("timed_out", False),
            "duration_ms": state.get("duration_ms"),
            "cmdline": state.get("cmdline"),
            "stderr": stderr[:4000],
            "error": state.get("error"),
        },
    }


async def _wait(task_id: str, deadline: float) -> Optional[Dict[str, Any]]:
    import asyncio

    while time.monotonic() < deadline:
        state = load_task_state(task_id)
        if state and state.get("status") in ("success", "failure", "canceled"):
            return state
        await asyncio.sleep(POLL_INTERVAL)
    return load_task_state(task_id)


# --------------------------------------------------------------------------- #
# endpoints
# --------------------------------------------------------------------------- #
@router.get("/v1/models")
async def list_models(
    authorization: Optional[str] = Header(default=None),
    x_api_key: Optional[str] = Header(default=None, alias="X-API-Key"),
):
    _, denied = _identity(authorization, x_api_key)
    if denied:
        return denied
    return {
        "object": "list",
        "data": [
            {
                "id": MODEL_ID,
                "object": "model",
                "created": int(time.time()),
                "owned_by": OWNER,
            }
        ],
    }


@router.get("/v1/models/{model_id}")
async def get_model(
    model_id: str,
    authorization: Optional[str] = Header(default=None),
    x_api_key: Optional[str] = Header(default=None, alias="X-API-Key"),
):
    _, denied = _identity(authorization, x_api_key)
    if denied:
        return denied
    if model_id != MODEL_ID:
        return _error(404, f"The model '{model_id}' does not exist", "model_not_found")
    return {"id": MODEL_ID, "object": "model", "created": int(time.time()), "owned_by": OWNER}


@router.post("/v1/chat/completions")
async def chat_completions(
    request: Request,
    authorization: Optional[str] = Header(default=None),
    x_api_key: Optional[str] = Header(default=None, alias="X-API-Key"),
):
    identity, denied = _identity(authorization, x_api_key)
    if denied:
        return denied

    try:
        body = await request.json()
    except Exception:
        return _error(400, "Request body must be valid JSON", "invalid_json")

    if not isinstance(body, dict):
        return _error(400, "Request body must be a JSON object", "invalid_request_body")

    model = str(body.get("model") or MODEL_ID)
    messages = body.get("messages")
    if not isinstance(messages, list) or not messages:
        return _error(400, "'messages' must be a non-empty array", "invalid_messages")

    prompt = build_prompt(messages)
    if not prompt:
        return _error(400, "No usable text content found in 'messages'", "empty_prompt")

    if len(prompt) > int(os.getenv("OPENAI_MAX_PROMPT_CHARS", "200000")):
        return _error(400, "Prompt too long", "prompt_too_long")

    raw_timeout = body.get("timeout")
    try:
        timeout = float(raw_timeout) if raw_timeout else min(DEFAULT_TIMEOUT, REQUEST_TIMEOUT)
    except (TypeError, ValueError):
        return _error(400, "'timeout' must be a number of seconds", "invalid_timeout")
    timeout = max(1.0, min(timeout, MAX_TIMEOUT))

    events_mode = bool(body.get("events"))
    raw_prefix = body.get("myflicker_args")
    if raw_prefix is not None and (
        not isinstance(raw_prefix, list) or not all(isinstance(item, str) for item in raw_prefix)
    ):
        return _error(400, "'myflicker_args' must be an array of strings", "invalid_myflicker_args")

    if events_mode:
        # structured agent events: tool calls, reasoning, session id
        args_prefix = [
            "-q",
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--stream-text",
        ]
        if raw_prefix:
            args_prefix.extend(raw_prefix)
        stdin_payload = (
            json.dumps(
                {"type": "user", "message": {"role": "user", "content": prompt}},
                ensure_ascii=False,
            )
            + "\n"
        )
    else:
        args_prefix = list(raw_prefix) if raw_prefix is not None else list(DEFAULT_ARGS)
        stdin_payload = None

    requested_cwd = body.get("cwd") if isinstance(body.get("cwd"), str) else None
    client_ip = request.client.host if request.client else "unknown"
    try:
        cwd = str(resolve_cwd(identity, requested_cwd, client_ip))
    except PermissionError as exc:
        return _error(403, str(exc), "cwd_outside_workspace")
    env_extra = body.get("env") if isinstance(body.get("env"), dict) else None
    stream = bool(body.get("stream"))
    trim_prompt = bool(body.get("trim_prompt", True))
    submitted = _submit(
        prompt, list(args_prefix), timeout, cwd, env_extra, "openai", identity, stdin_payload
    )

    if stream:
        return StreamingResponse(
            _sse(
                task_id=submitted["task_id"],
                model=model,
                prompt=prompt,
                timeout=timeout,
                events_mode=events_mode,
            ),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
                "X-Myflicker-Task-Id": submitted["task_id"],
            },
        )

    state = await _wait(submitted["task_id"], time.monotonic() + timeout + 5)
    if not state or state.get("status") in (None, "pending", "running"):
        return _error(
            504,
            f"myflicker task {submitted['task_id']} did not finish within {timeout}s",
            "upstream_timeout",
            "timeout_error",
        )
    return _result_payload(submitted["task_id"], model, prompt, state)


async def _sse(
    task_id: str,
    model: str,
    prompt: str,
    timeout: float,
    events_mode: bool = False,
) -> AsyncIterator[str]:
    """SSE stream. Text mode forwards stdout chunks; events mode forwards the
    agent's structured events (session id, reasoning, tool calls, results)."""
    import asyncio

    created = int(time.time())
    chunk_id = f"chatcmpl-{task_id[:24]}"
    index = 0
    emitted_any = False

    def frame(delta: Dict[str, Any], finish: Optional[str] = None, extra: Optional[Dict[str, Any]] = None) -> str:
        payload: Dict[str, Any] = {
            "id": chunk_id,
            "object": "chat.completion.chunk",
            "created": created,
            "model": model,
            "system_fingerprint": "myflicker-gateway",
            "choices": [{"index": 0, "delta": delta, "logprobs": None, "finish_reason": finish}],
        }
        if extra:
            payload.update(extra)
        return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"

    yield frame({"role": "assistant", "content": ""})

    deadline = time.monotonic() + timeout + 5
    last_ping = time.monotonic()
    finished = False
    previous_text = ""
    session_id: Optional[str] = None
    usage: Optional[Dict[str, Any]] = None

    while not finished:
        chunks, index = read_stream(task_id, index)
        for chunk in chunks:
            if chunk.get("stream") == "__end__":
                finished = True
                break
            if chunk.get("stream") != "stdout":
                continue
            text = chunk.get("text") or ""
            if not text:
                continue

            if not events_mode:
                emitted_any = True
                yield frame({"content": text})
                continue

            line = text.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                emitted_any = True
                yield frame({"content": text})
                continue

            kind = event.get("type")
            if kind == "text":
                snapshot = event.get("text") or ""
                if snapshot.startswith(previous_text):
                    delta = snapshot[len(previous_text):]
                else:
                    delta = snapshot
                if not event.get("partial"):
                    previous_text = ""
                else:
                    previous_text = snapshot
                if delta:
                    emitted_any = True
                    yield frame({"content": delta}, extra={"x_myflicker_event": event})
                continue

            if kind == "system" and event.get("subtype") == "init":
                session_id = event.get("sessionId") or session_id
            if kind == "result":
                usage = event.get("usage") or usage
                session_id = event.get("sessionId") or session_id

            yield frame({}, extra={"x_myflicker_event": event})

        state = load_task_state(task_id) or {}
        if not finished and state.get("status") in ("success", "failure", "canceled"):
            finished = True
        if finished:
            break

        if time.monotonic() > deadline:
            yield frame({"content": f"\n[gateway] task {task_id} exceeded {timeout}s\n"})
            break

        if time.monotonic() - last_ping > 10:
            last_ping = time.monotonic()
            yield ": keep-alive\n\n"
        await asyncio.sleep(0.15)

    state = load_task_state(task_id) or {}
    leftovers, _ = read_stream(task_id, index)
    for chunk in leftovers:
        if chunk.get("stream") == "stdout" and chunk.get("text"):
            text = chunk["text"]
            if events_mode:
                try:
                    event = json.loads(text.strip())
                except json.JSONDecodeError:
                    event = None
                if event is not None:
                    if event.get("type") == "text" and event.get("text"):
                        emitted_any = True
                        yield frame({"content": event["text"]}, extra={"x_myflicker_event": event})
                    else:
                        yield frame({}, extra={"x_myflicker_event": event})
                    continue
            emitted_any = True
            yield frame({"content": text})

    if not emitted_any and state.get("status") != "success":
        detail = state.get("error") or state.get("status") or "unknown error"
        stderr = (state.get("stderr") or "").strip()
        yield frame({"content": f"[myflicker failed: {detail}]" + (f"\n{stderr}" if stderr else "")})

    prompt_tokens = _estimate_tokens(prompt)
    completion_tokens = _estimate_tokens(state.get("stdout") or "")
    final: Dict[str, Any] = {
        "id": chunk_id,
        "object": "chat.completion.chunk",
        "created": created,
        "model": model,
        "choices": [
            {
                "index": 0,
                "delta": {},
                "logprobs": None,
                "finish_reason": "stop" if state.get("status") == "success" else "error",
            }
        ],
        "usage": usage
        or {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": prompt_tokens + completion_tokens,
        },
        "x_myflicker": {
            "task_id": task_id,
            "status": state.get("status"),
            "returncode": state.get("returncode"),
            "duration_ms": state.get("duration_ms"),
            "session_id": session_id,
        },
    }
    yield f"data: {json.dumps(final, ensure_ascii=False)}\n\n"
    yield "data: [DONE]\n\n"
