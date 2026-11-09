#!/usr/bin/env bash
# Optional smoke-test double for the real myflicker CLI.
# Point MYFLICKER_BIN at this file to validate the whole gateway without
# touching real data. It prints argv to stdout, warns on stderr and supports
# "sleep <n>" / "fail" to exercise the timeout and non-zero-returncode paths.
set -u

echo "mock_myflicker argv: $*"

case "${1:-}" in
  sleep)
    secs="${2:-5}"
    echo "sleeping ${secs}s in pid $$"
    sleep "$secs"
    echo "woke up"
    ;;
  fail)
    echo "intentional failure" >&2
    exit 3
    ;;
  *)
    echo "mock myflicker done, workspace=$(pwd)"
    ;;
esac
