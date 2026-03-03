#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENGINE_DIR="$ROOT_DIR/services/engine"
ENV_FILE="$ROOT_DIR/.env.local"

load_env() {
  if [[ -f "$ENV_FILE" ]]; then
    set -a
    # shellcheck source=/dev/null
    source "$ENV_FILE"
    set +a
  fi
}

start_worker() {
  if [[ "${SKIP_FACTORLAB_WORKER:-0}" == "1" ]]; then
    echo "[dev] SKIP_FACTORLAB_WORKER=1 -> not starting engine worker"
    return
  fi

  if [[ ! -d "$ENGINE_DIR" ]]; then
    echo "[dev] engine dir missing at $ENGINE_DIR; continuing without worker"
    return
  fi

  local worker_cmd=""
  if [[ -x "$ENGINE_DIR/.venv/bin/factorlab-engine-worker" ]]; then
    worker_cmd="$ENGINE_DIR/.venv/bin/factorlab-engine-worker"
  elif command -v factorlab-engine-worker >/dev/null 2>&1; then
    worker_cmd="factorlab-engine-worker"
  elif [[ -x "$ENGINE_DIR/.venv/bin/python" ]]; then
    worker_cmd="$ENGINE_DIR/.venv/bin/python -m factorlab_engine.worker"
  elif command -v python3 >/dev/null 2>&1; then
    worker_cmd="PYTHONPATH=$ENGINE_DIR python3 -m factorlab_engine.worker"
  fi

  if [[ -z "$worker_cmd" ]]; then
    echo "[dev] factorlab worker command not found; continuing without worker"
    echo "[dev] hint: cd services/engine && pip install -e ."
    return
  fi

  echo "[dev] starting factorlab worker..."
  (
    cd "$ENGINE_DIR"
    eval "$worker_cmd"
  ) &
  WORKER_PID=$!
  echo "[dev] worker pid: $WORKER_PID"
}

cleanup() {
  if [[ -n "${WORKER_PID:-}" ]] && kill -0 "$WORKER_PID" >/dev/null 2>&1; then
    echo "[dev] stopping factorlab worker (pid $WORKER_PID)"
    kill "$WORKER_PID" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

load_env
start_worker

cd "$ROOT_DIR"
npm run dev:web
