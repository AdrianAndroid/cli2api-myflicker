#!/usr/bin/env python3
"""Test client for the myflicker HTTP gateway.

Usage:
    python test_client.py list --verbose
    python test_client.py run --file ./demo.json --timeout 600
    python test_client.py --api-url http://127.0.0.1:8000 list --verbose

Rules:
    * known client flags are consumed by this script;
    * anything else on the command line is forwarded to myflicker as args[].

Exit codes: 0 = myflicker success, 1 = myflicker failure/timeout, 2 = client error.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Tuple

import httpx
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(dotenv_path=BASE_DIR / ".env")


def ts() -> str:
    return datetime.now(timezone.utc).strftime("%H:%M:%S")


def log(message: str) -> None:
    print(f"[{ts()}] {message}", flush=True)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Submit a myflicker task to the gateway and poll its result.",
        epilog=(
            "Any argument not listed here is forwarded to myflicker.\n"
            "Example: python test_client.py list --verbose"
        ),
        add_help=True,
    )
    parser.add_argument("--api-url", default=os.getenv("API_URL", "http://127.0.0.1:8000"))
    parser.add_argument("--api-key", default=os.getenv("API_KEY", ""))
    parser.add_argument("--timeout", type=float, default=None, help="myflicker timeout, seconds")
    parser.add_argument("--cwd", default=None, help="working directory for myflicker")
    parser.add_argument("--env", action="append", default=[], metavar="K=V",
                        help="extra env var for myflicker, repeatable")
    parser.add_argument("--source", default="test_client")
    parser.add_argument("--poll-interval", type=float,
                        default=float(os.getenv("POLL_INTERVAL", "1.0")))
    parser.add_argument("--max-retries", type=int,
                        default=int(os.getenv("MAX_RETRIES", "300")),
                        help="max number of result polls")
    parser.add_argument("--max-wait", type=float,
                        default=float(os.getenv("MAX_WAIT", "1200")),
                        help="overall wall clock budget, seconds")
    parser.add_argument("--show-events", action="store_true",
                        help="include the server-side event log in the final output")
    return parser


def parse_cli() -> Tuple[argparse.Namespace, List[str]]:
    parser = build_parser()
    known, passthrough = parser.parse_known_args()
    return known, passthrough


def parse_env_pairs(pairs: List[str]) -> Dict[str, str]:
    env: Dict[str, str] = {}
    for pair in pairs:
        if "=" not in pair:
            log(f"WARN  ignored --env {pair!r} (expected K=V)")
            continue
        key, value = pair.split("=", 1)
        env[key] = value
    return env


def print_result(result: Dict[str, Any], show_events: bool) -> None:
    print("-" * 78)
    print(f"status      : {result.get('status')}")
    print(f"returncode  : {result.get('returncode')}")
    print(f"timed_out   : {result.get('timed_out')}")
    print(f"duration_ms : {result.get('duration_ms')}")
    print(f"cmdline     : {result.get('cmdline')}")
    print(f"cwd         : {result.get('cwd')}")
    print(f"error       : {result.get('error')}")
    print("-" * 78)
    print("--- stdout ---")
    print(result.get("stdout") or "")
    print("--- stderr ---")
    print(result.get("stderr") or "")
    if show_events and result.get("events"):
        print("--- events ---")
        for event in result["events"]:
            print(json.dumps(event, ensure_ascii=False))
    print("-" * 78)


def main() -> int:
    options, myflicker_args = parse_cli()

    if not options.api_key:
        log("ERROR API_KEY is empty (set it in .env or pass --api-key)")
        return 2

    base_url = options.api_url.rstrip("/")
    payload: Dict[str, Any] = {
        "args": myflicker_args,
        "source": options.source,
    }
    if options.timeout:
        payload["timeout"] = options.timeout
    if options.cwd:
        payload["cwd"] = options.cwd
    env_extra = parse_env_pairs(options.env)
    if env_extra:
        payload["env"] = env_extra

    headers = {"X-API-Key": options.api_key, "Content-Type": "application/json"}

    log(f"SUBMIT url={base_url}/api/myflicker/submit args={myflicker_args}")
    started = time.monotonic()
    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.post(
                f"{base_url}/api/myflicker/submit", headers=headers, json=payload
            )
            if response.status_code == 401:
                log(f"ERROR 401 unauthorized: {response.text}")
                return 2
            if response.status_code >= 400:
                log(f"ERROR submit failed {response.status_code}: {response.text}")
                return 2
            submitted = response.json()
            task_id = submitted["task_id"]
            log(
                f"SUBMITTED task_id={task_id} status={submitted.get('status')} "
                f"timeout={submitted.get('timeout')} poll_hint_ms={submitted.get('poll_hint_ms')}"
            )

            interval = max(options.poll_interval, 0.2)
            deadline = started + options.max_wait
            attempt = 0
            result: Dict[str, Any] = {}

            while attempt < options.max_retries:
                attempt += 1
                time.sleep(interval)

                query = "?include_events=true" if options.show_events else ""
                poll = client.get(
                    f"{base_url}/api/myflicker/result/{task_id}{query}", headers=headers
                )
                if poll.status_code == 401:
                    log("ERROR 401 unauthorized while polling")
                    return 2
                if poll.status_code == 404:
                    log(f"ERROR task expired/unknown: {poll.text}")
                    return 2
                if poll.status_code >= 400:
                    log(f"WARN  poll #{attempt} http {poll.status_code}: {poll.text}")
                else:
                    result = poll.json()
                    elapsed = time.monotonic() - started
                    log(
                        f"POLL #{attempt} status={result.get('status')} "
                        f"elapsed={elapsed:.1f}s "
                        f"started_at={result.get('started_at')} "
                        f"returncode={result.get('returncode')}"
                    )
                    if result.get("status") in ("success", "failure"):
                        break

                if time.monotonic() > deadline:
                    log(f"ERROR gave up after {options.max_wait}s (max_wait)")
                    print_result(result, options.show_events)
                    return 2

                interval = min(interval * 1.15, 5.0)

            else:
                log(f"ERROR gave up after {options.max_retries} polls (max_retries)")
                print_result(result, options.show_events)
                return 2
    except httpx.RequestError as exc:
        log(f"ERROR cannot reach gateway {base_url}: {exc}")
        return 2

    total = time.monotonic() - started
    log(f"FINISHED task_id={task_id} status={result.get('status')} wall={total:.1f}s")
    print_result(result, options.show_events)

    if result.get("status") == "success":
        log("RESULT: success")
        return 0
    log(f"RESULT: failure ({result.get('error')})")
    return 1


if __name__ == "__main__":
    sys.exit(main())
