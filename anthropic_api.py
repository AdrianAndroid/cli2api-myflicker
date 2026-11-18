"""Anthropic-compatible facade over the myflicker CLI.

Claude Code and other Anthropic Messages clients can point their base URL here:

    ANTHROPIC_BASE_URL=http://127.0.0.1:8000
    ANTHROPIC_AUTH_TOKEN=$API_KEY        # sent as the x-api-key header

Transport is unchanged: every request becomes one `myflicker -q "<prompt>"` job
on the caller's own single-concurrency Celery queue, so myflicker is still never
executed in parallel for the same working directory.

Endpoints:
    POST /v1/messages               (stream=true -> Anthropic SSE events)
    POST /v1/messages/count_tokens
"""

from __future__ import annotations

import json
import hashlib
import os
import re
import time
import uuid
from pathlib import Path
from typing import Any, AsyncIterator, Dict, List, Optional

from dotenv import load_dotenv
from fastapi import APIRouter, Header, Request
from fastapi.responses import JSONResponse, StreamingResponse

from identity import resolve_cwd, resolve_key
from openai_api import (
    DEFAULT_ARGS,
    DEFAULT_TIMEOUT,
    MAX_TIMEOUT,
    REQUEST_TIMEOUT,
    _estimate_tokens,
    _submit,
    _token_from_headers,
    _wait,
    iter_task_stream,
)
from celery_tasks import flush_logs, load_task_state, log_event, trace_event

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(dotenv_path=BASE_DIR / ".env")

DEFAULT_MODEL = os.getenv("ANTHROPIC_MODEL_ID", os.getenv("OPENAI_MODEL_ID", "myflicker-agent"))
MAX_PROMPT_CHARS = int(os.getenv("ANTHROPIC_MAX_PROMPT_CHARS", "200000"))
TRACE_EVENTS = os.getenv("ANTHROPIC_TRACE_EVENTS", "0").strip().lower() in ("1", "true", "yes", "on")
PROMPT_PREVIEW_CHARS = 512
STREAM_JSON_ARGS = ["-q", "--input-format", "stream-json", "--output-format", "stream-json", "--stream-text"]
WORKDIR_RE = re.compile(r"(?:Primary working directory|Working directory)\s*:\s*([^\r\n<]+)", re.IGNORECASE)

router = APIRouter(tags=["anthropic"])


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def _error(status_code: int, err_type: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"type": "error", "error": {"type": err_type, "message": message}},
    )


def _identity(
    authorization: Optional[str],
    x_api_key: Optional[str],
    anthropic_key: Optional[str],
):
    token = _token_from_headers(authorization, anthropic_key or x_api_key)
    if not token:
        return None, _error(
            401,
            "authentication_error",
            "Missing API key. Send 'x-api-key: <key>' or 'Authorization: Bearer <key>'.",
        )
    identity = resolve_key(token)
    if identity is None:
        return None, _error(401, "authentication_error", "Incorrect API key provided.")
    return identity, None


def _block_text(block: Dict[str, Any]) -> str:
    kind = block.get("type")
    if kind in (None, "text") and isinstance(block.get("text"), str):
        return block["text"]
    if kind == "tool_use":
        name = block.get("name") or "tool"
        payload = json.dumps(block.get("input"), ensure_ascii=False)
        return f"[tool_use {name}] {payload}"
    if kind == "tool_result":
        return f"[tool_result] {_tool_result_text(block.get('content'))}"
    return ""


def _tool_result_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: List[str] = []
        for item in content:
            if isinstance(item, dict):
                text = _block_text(item)
                if text:
                    parts.append(text)
            elif item is not None:
                parts.append(str(item))
        return "\n".join(parts)
    if content is None:
        return ""
    return json.dumps(content, ensure_ascii=False)


def _content_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = [_block_text(item) for item in content if isinstance(item, dict)]
        return "\n".join(part for part in parts if part)
    return ""


def _system_text(system: Any) -> str:
    return _content_text(system).strip()


def build_prompt(body: Dict[str, Any]) -> str:
    messages = body.get("messages") or []
    turns: List[str] = []
    system_text = _system_text(body.get("system"))
    if system_text:
        turns.append(f"System: {system_text}")
    for message in messages:
        if not isinstance(message, dict):
            continue
        text = _content_text(message.get("content")).strip()
        if not text:
            continue
        role = message.get("role", "user")
        turns.append(text if len(messages) == 1 else f"{role}: {text}")
    return "\n\n".join(turns).strip()


def _last_user_text(messages: List[Any]) -> str:
    for message in reversed(messages):
        if isinstance(message, dict) and message.get("role") == "user":
            return _content_text(message.get("content")).strip()
    return ""


def _valid_session_id(session_id: Any) -> Optional[str]:
    if session_id is None:
        return None
    if not isinstance(session_id, str):
        return ""
    value = session_id.strip()
    allowed = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.:")
    if not (1 <= len(value) <= 128) or any(ch not in allowed for ch in value):
        return ""
    return value


def _usage(prompt: str, text: str) -> Dict[str, int]:
    return {
        "input_tokens": _estimate_tokens(prompt),
        "output_tokens": _estimate_tokens(text),
    }


def _debug(state: Dict[str, Any], task_id: str, tools: Optional[List[Any]], client_user_id: Any) -> Dict[str, Any]:
    debug: Dict[str, Any] = {
        "task_id": task_id,
        "status": state.get("status"),
        "returncode": state.get("returncode"),
        "timed_out": state.get("timed_out", False),
        "duration_ms": state.get("duration_ms"),
        "cmdline": state.get("cmdline"),
        "stderr": (state.get("stderr") or "")[:4000],
        "error": state.get("error"),
    }
    if tools:
        debug["tools_ignored"] = len(tools)
    if isinstance(client_user_id, str) and client_user_id:
        debug["client_user_id"] = client_user_id
    return debug


def _request_id(request: Request) -> str:
    value = getattr(request.state, "request_id", None)
    if value:
        return value
    generated = uuid.uuid4().hex[:16]
    request.state.request_id = generated
    return generated


def _prompt_digest(prompt: str) -> tuple[str, str]:
    return hashlib.sha256(prompt.encode("utf-8")).hexdigest(), prompt[:PROMPT_PREVIEW_CHARS]


def _detect_workdir(body: Dict[str, Any]) -> Optional[str]:
    candidates: List[str] = []
    system_text = _system_text(body.get("system"))
    if system_text:
        candidates.append(system_text)
    for message in body.get("messages") or []:
        if not isinstance(message, dict):
            continue
        text = _content_text(message.get("content"))
        if text:
            candidates.append(text)
    for text in candidates:
        for match in WORKDIR_RE.finditer(text):
            candidate = match.group(1).strip().strip("`\"' \t")
            candidate = candidate.rstrip(".,;")
            if not candidate or not os.path.isabs(candidate):
                continue
            if os.path.isdir(candidate):
                return candidate
    return None


def _resolve_request_cwd(
    identity,
    body_cwd: Optional[str],
    header_cwd: Optional[str],
    detected_cwd: Optional[str],
    client_ip: str,
) -> tuple[str, str]:
    if body_cwd:
        return str(resolve_cwd(identity, body_cwd, client_ip)), "body"
    if header_cwd:
        return str(resolve_cwd(identity, header_cwd, client_ip)), "header"
    if detected_cwd:
        try:
            return str(resolve_cwd(identity, detected_cwd, client_ip)), "prompt"
        except PermissionError:
            return str(resolve_cwd(identity, None, client_ip)), "prompt"
    return str(resolve_cwd(identity, None, client_ip)), "workspace"


def _log_request_accepted(
    task_id: str,
    request_id: str,
    model: str,
    stream: bool,
    session_id: Optional[str],
    cwd: str,
    cwd_source: str,
    prompt: str,
) -> None:
    digest, preview = _prompt_digest(prompt)
    log_event(
        task_id,
        "request.accepted",
        request_id=request_id,
        model=model,
        stream=stream,
        session_id=session_id,
        cwd=cwd,
        cwd_source=cwd_source,
        prompt_len=len(prompt),
        prompt_sha256=digest,
        prompt_preview=preview,
    )


def _log_request_finished(
    task_id: str,
    request_id: str,
    status: Optional[str],
    duration_ms: int,
    http_status: int,
) -> None:
    log_event(
        task_id,
        "request.finished",
        request_id=request_id,
        status=status,
        duration_ms=duration_ms,
        http_status=http_status,
    )
    flush_logs()


def _parse_event_lines(text: str) -> List[Dict[str, Any]]:
    events: List[Dict[str, Any]] = []
    for line in (text or "").splitlines():
        chunk = line.strip()
        if not chunk:
            continue
        try:
            event = json.loads(chunk)
        except json.JSONDecodeError:
            continue
        if isinstance(event, dict):
            events.append(event)
    return events


def _events_text(events: List[Dict[str, Any]]) -> str:
    previous = ""
    parts: List[str] = []
    for event in events:
        if event.get("type") != "text":
            continue
        snapshot = event.get("text") or ""
        delta = snapshot[len(previous):] if snapshot.startswith(previous) else snapshot
        previous = snapshot if event.get("partial") else ""
        if delta:
            parts.append(delta)
    return "".join(parts)


def _message_payload(
    task_id: str,
    model: str,
    prompt: str,
    state: Dict[str, Any],
    tools: Optional[List[Any]],
    client_user_id: Any,
    text: Optional[str] = None,
) -> Dict[str, Any]:
    status = state.get("status")
    stdout = (state.get("stdout") or "").rstrip("\n")
    stderr = (state.get("stderr") or "").rstrip("\n")
    if text is not None:
        content = text
    elif status == "success":
        content = stdout
    else:
        content = stdout or f"[myflicker failed: {state.get('error') or status}]\n{stderr}".strip()
    return {
        "id": f"msg_{task_id[:24]}",
        "type": "message",
        "role": "assistant",
        "model": model,
        "content": [{"type": "text", "text": content}],
        "stop_reason": "end_turn",
        "stop_sequence": None,
        "usage": _usage(prompt, content),
        "x_myflicker": _debug(state, task_id, tools, client_user_id),
    }


def _parse_body(body: Dict[str, Any]):
    messages = body.get("messages")
    if not isinstance(messages, list) or not messages:
        return None, _error(400, "invalid_request_error", "'messages' must be a non-empty array")
    raw_max_tokens = body.get("max_tokens")
    if raw_max_tokens is not None:
        if not isinstance(raw_max_tokens, (int, float)) or isinstance(raw_max_tokens, bool):
            return None, _error(400, "invalid_request_error", "'max_tokens' must be a number")
        if raw_max_tokens < 0:
            return None, _error(400, "invalid_request_error", "'max_tokens' must not be negative")
    tools = body.get("tools") if isinstance(body.get("tools"), list) else None
    metadata = body.get("metadata") if isinstance(body.get("metadata"), dict) else {}
    return {"messages": messages, "tools": tools, "metadata": metadata}, None


def _resolve_timeout(body: Dict[str, Any]):
    raw = body.get("timeout")
    if raw is None:
        return min(DEFAULT_TIMEOUT, REQUEST_TIMEOUT), None
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None, _error(400, "invalid_request_error", "'timeout' must be a number of seconds")
    return max(1.0, min(value, MAX_TIMEOUT)), None


# --------------------------------------------------------------------------- #
# endpoints
# --------------------------------------------------------------------------- #
@router.post("/v1/messages")
async def create_message(
    request: Request,
    authorization: Optional[str] = Header(default=None),
    x_api_key: Optional[str] = Header(default=None, alias="X-API-Key"),
    anthropic_key: Optional[str] = Header(default=None, alias="x-api-key"),
    myflicker_cwd: Optional[str] = Header(default=None, alias="X-Myflicker-Cwd"),
):
    identity, denied = _identity(authorization, x_api_key, anthropic_key)
    if denied:
        return denied

    try:
        body = await request.json()
    except Exception:
        return _error(400, "invalid_request_error", "Request body must be valid JSON")
    if not isinstance(body, dict):
        return _error(400, "invalid_request_error", "Request body must be a JSON object")

    parsed, invalid = _parse_body(body)
    if invalid:
        return invalid
    messages = parsed["messages"]
    tools = parsed["tools"]
    client_user_id = parsed["metadata"].get("user_id")

    timeout, timeout_error = _resolve_timeout(body)
    if timeout_error:
        return timeout_error

    session_id = _valid_session_id(body.get("session_id"))
    if session_id == "":
        return _error(400, "invalid_request_error", "'session_id' contains invalid characters")

    prompt = build_prompt(body)
    if not prompt:
        return _error(400, "invalid_request_error", "No usable text content found in 'messages'")
    if session_id:
        last_text = _last_user_text(messages)
        if last_text:
            prompt = last_text

    if len(prompt) > MAX_PROMPT_CHARS:
        return _error(400, "prompt_too_long", "Prompt too long")

    raw_prefix = body.get("myflicker_args")
    if raw_prefix is not None and (
        not isinstance(raw_prefix, list) or not all(isinstance(item, str) for item in raw_prefix)
    ):
        return _error(400, "invalid_request_error", "'myflicker_args' must be an array of strings")
    if TRACE_EVENTS:
        args_prefix = list(STREAM_JSON_ARGS)
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
    if session_id and "--resume" not in args_prefix:
        args_prefix.extend(["--resume", session_id])

    requested_cwd = body.get("cwd") if isinstance(body.get("cwd"), str) else None
    header_cwd = myflicker_cwd.strip() if isinstance(myflicker_cwd, str) and myflicker_cwd.strip() else None
    detected_cwd = _detect_workdir(body)
    client_ip = request.client.host if request.client else "unknown"
    try:
        cwd, cwd_source = _resolve_request_cwd(
            identity, requested_cwd, header_cwd, detected_cwd, client_ip
        )
    except PermissionError as exc:
        return _error(403, "permission_error", str(exc))
    env_extra = body.get("env") if isinstance(body.get("env"), dict) else None

    model = str(body.get("model") or DEFAULT_MODEL)
    request_id = _request_id(request)
    request_started = time.monotonic()
    submitted = _submit(
        prompt,
        args_prefix,
        timeout,
        cwd,
        env_extra,
        "anthropic",
        identity,
        stdin_payload=stdin_payload,
        request_id=request_id,
    )
    task_id = submitted["task_id"]
    stream = bool(body.get("stream"))
    _log_request_accepted(task_id, request_id, model, stream, session_id, cwd, cwd_source, prompt)

    if stream:
        return StreamingResponse(
            _sse(
                task_id=task_id,
                model=model,
                prompt=prompt,
                timeout=timeout,
                tools=tools,
                client_user_id=client_user_id,
                request_id=request_id,
                started=request_started,
                trace_events=TRACE_EVENTS,
            ),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
                "X-Myflicker-Task-Id": task_id,
            },
        )

    state = await _wait(task_id, time.monotonic() + timeout + 5)
    if not state or state.get("status") in (None, "pending", "running"):
        _log_request_finished(
            task_id,
            request_id,
            (state or {}).get("status"),
            int((time.monotonic() - request_started) * 1000),
            504,
        )
        return _error(
            504,
            "timeout_error",
            f"myflicker task {task_id} did not finish within {timeout}s",
        )

    text_override: Optional[str] = None
    if TRACE_EVENTS:
        events = _parse_event_lines(state.get("stdout") or "")
        for event in events:
            trace_event(task_id, event)
        text_override = _events_text(events)
        if state.get("status") != "success" and not text_override:
            text_override = None

    payload = _message_payload(task_id, model, prompt, state, tools, client_user_id, text=text_override)
    _log_request_finished(
        task_id,
        request_id,
        state.get("status"),
        int((time.monotonic() - request_started) * 1000),
        200,
    )
    return JSONResponse(content=payload, headers={"X-Myflicker-Task-Id": task_id})



@router.post("/v1/messages/count_tokens")
async def count_tokens(
    request: Request,
    authorization: Optional[str] = Header(default=None),
    x_api_key: Optional[str] = Header(default=None, alias="X-API-Key"),
    anthropic_key: Optional[str] = Header(default=None, alias="x-api-key"),
):
    identity, denied = _identity(authorization, x_api_key, anthropic_key)
    if denied:
        return denied

    try:
        body = await request.json()
    except Exception:
        return _error(400, "invalid_request_error", "Request body must be valid JSON")
    if not isinstance(body, dict):
        return _error(400, "invalid_request_error", "Request body must be a JSON object")

    parsed, invalid = _parse_body(body)
    if invalid:
        return invalid

    prompt = build_prompt(body)
    if not prompt:
        return _error(400, "invalid_request_error", "No usable text content found in 'messages'")
    if len(prompt) > MAX_PROMPT_CHARS:
        return _error(400, "prompt_too_long", "Prompt too long")
    return {"input_tokens": _estimate_tokens(prompt)}


async def _sse(
    task_id: str,
    model: str,
    prompt: str,
    timeout: float,
    tools: Optional[List[Any]] = None,
    client_user_id: Any = None,
    request_id: str = "",
    started: float = 0.0,
    trace_events: bool = False,
) -> AsyncIterator[str]:
    created = int(time.time())
    message_id = f"msg_{task_id[:24]}"

    def sse(event: str, data: Dict[str, Any]) -> str:
        return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"

    previous_text = ""
    emitted_any = False
    pieces: List[str] = []

    def delta(text: str) -> str:
        pieces.append(text)
        return sse(
            "content_block_delta",
            {
                "type": "content_block_delta",
                "index": 0,
                "delta": {"type": "text_delta", "text": text},
            },
        )

    try:
        yield sse(
            "message_start",
            {
                "type": "message_start",
                "message": {
                    "id": message_id,
                    "type": "message",
                    "role": "assistant",
                    "model": model,
                    "content": [],
                    "stop_reason": None,
                    "stop_sequence": None,
                    "usage": {"input_tokens": _estimate_tokens(prompt), "output_tokens": 0},
                    "x_myflicker": _debug({}, task_id, tools, client_user_id),
                },
                "x_myflicker_task_id": task_id,
            },
        )
        yield sse(
            "content_block_start",
            {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}},
        )

        async for item in iter_task_stream(task_id, timeout):
            kind = item.get("type")
            if kind == "keepalive":
                yield ": keep-alive\n\n"
                continue
            if kind == "timeout":
                emitted_any = True
                yield delta(f"\n[gateway] task {task_id} exceeded {timeout}s\n")
                continue
            if kind == "end":
                break
            text = item.get("text") or ""
            if not text:
                continue

            if trace_events:
                events = _parse_event_lines(text)
                if events:
                    for event in events:
                        trace_event(task_id, event)
                        if event.get("type") != "text":
                            continue
                        snapshot = event.get("text") or ""
                        if snapshot.startswith(previous_text):
                            piece = snapshot[len(previous_text):]
                        else:
                            piece = snapshot
                        previous_text = snapshot if event.get("partial") else ""
                        if piece:
                            emitted_any = True
                            yield delta(piece)
                    continue

            emitted_any = True
            yield delta(text)

        state = load_task_state(task_id) or {}
        if not emitted_any and state.get("status") != "success":
            detail = state.get("error") or state.get("status") or "unknown error"
            stderr = (state.get("stderr") or "").strip()
            yield delta(f"[myflicker failed: {detail}]" + (f"\n{stderr}" if stderr else ""))

        yield sse("content_block_stop", {"type": "content_block_stop", "index": 0})
        yield sse(
            "message_delta",
            {
                "type": "message_delta",
                "delta": {"stop_reason": "end_turn", "stop_sequence": None},
                "usage": {"output_tokens": _estimate_tokens("".join(pieces))},
                "x_myflicker": _debug(state, task_id, tools, client_user_id),
            },
        )
        yield sse("message_stop", {"type": "message_stop"})
    finally:
        state = load_task_state(task_id) or {}
        duration_ms = int((time.monotonic() - started) * 1000) if started else 0
        _log_request_finished(task_id, request_id or "-", state.get("status"), duration_ms, 200)
