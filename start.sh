#!/usr/bin/env bash

set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$project_dir"

web_port="${PORT:-3000}"
api_port="${API_PORT:-}"

if [[ -z "$api_port" && -f .env ]]; then
  api_port="$(sed -nE 's/^[[:space:]]*API_PORT[[:space:]]*=[[:space:]]*([0-9]+)[[:space:]]*$/\1/p' .env | tail -n 1)"
fi
api_port="${api_port:-4010}"

validate_port() {
  local port="$1"
  local label="$2"
  if [[ ! "$port" =~ ^[0-9]+$ ]] || (( port < 1 || port > 65535 )); then
    printf 'Invalid %s port: %s\n' "$label" "$port" >&2
    exit 1
  fi
}

release_port() {
  local port="$1"
  local current_uid
  local pids
  current_uid="$(id -u)"
  pids="$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"

  if [[ -z "$pids" ]]; then
    return
  fi

  printf 'Port %s is in use. Stopping owned listener(s)…\n' "$port"
  while IFS= read -r pid; do
    [[ -n "$pid" ]] || continue
    if [[ "$(ps -o uid= -p "$pid" 2>/dev/null | tr -d ' ')" != "$current_uid" ]]; then
      printf 'Cannot stop PID %s on port %s because it is owned by another user.\n' "$pid" "$port" >&2
      exit 1
    fi
    printf '  PID %s: %s\n' "$pid" "$(ps -o command= -p "$pid" 2>/dev/null || printf 'unknown process')"
    kill -TERM "$pid" 2>/dev/null || true
  done <<< "$pids"

  for _ in {1..20}; do
    if ! lsof -nP -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      return
    fi
    sleep 0.1
  done

  pids="$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  while IFS= read -r pid; do
    [[ -n "$pid" ]] || continue
    if [[ "$(ps -o uid= -p "$pid" 2>/dev/null | tr -d ' ')" == "$current_uid" ]]; then
      printf '  PID %s did not stop; forcing shutdown.\n' "$pid"
      kill -KILL "$pid" 2>/dev/null || true
    fi
  done <<< "$pids"
}

validate_port "$web_port" "web"
validate_port "$api_port" "API"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  printf 'Node.js and npm are required. Install Node.js 22.13 or newer.\n' >&2
  exit 1
fi

if ! command -v lsof >/dev/null 2>&1; then
  printf 'lsof is required to safely identify listeners on ports %s and %s.\n' "$web_port" "$api_port" >&2
  exit 1
fi

release_port "$web_port"
if [[ "$api_port" != "$web_port" ]]; then
  release_port "$api_port"
fi

if [[ ! -d node_modules ]]; then
  printf 'Installing dependencies…\n'
  npm install
fi

printf 'Starting SignalLedger\n'
printf '  App: http://localhost:%s\n' "$web_port"
printf '  API: http://localhost:%s\n' "$api_port"
printf '  Live reload: enabled for app and API code\n'

export NODE_ENV=development
export PORT="$web_port"
export API_PORT="$api_port"
exec npx --no-install concurrently --kill-others-on-fail \
  "npm run dev:web -- --port $web_port" \
  "npm run dev:api"
