#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_ENV_FILE="${API_ENV_FILE:-$ROOT_DIR/apps/api/dev.env}"
COLLECTION_FILE="${COLLECTION_FILE:-$ROOT_DIR/docs/insomnia/job-microservice.insomnia.json}"
INSOMNIA_ENV="${INSOMNIA_ENV:-local}"
INSOMNIA_REQUEST_TIMEOUT_MS="${INSOMNIA_REQUEST_TIMEOUT_MS:-10000}"
API_READY_TIMEOUT_SECONDS="${API_READY_TIMEOUT_SECONDS:-90}"
JOBS_READY_TIMEOUT_SECONDS="${JOBS_READY_TIMEOUT_SECONDS:-60}"
LOG_DIR="${LOG_DIR:-$ROOT_DIR/logs/insomnia-jobs}"
API_LOG="$LOG_DIR/api.log"
JOBS_LOG="$LOG_DIR/jobs.log"

api_pid=""
jobs_pid=""
runtime_collection=""

cleanup() {
  local exit_code=$?

  terminate_process "$api_pid"
  terminate_process "$jobs_pid"
  if [ -n "$runtime_collection" ] && [ -f "$runtime_collection" ]; then
    rm -f "$runtime_collection"
  fi

  exit "$exit_code"
}

terminate_process() {
  local pid="${1:-}"
  if [ -z "$pid" ] || ! kill -0 "$pid" >/dev/null 2>&1; then
    return
  fi

  pkill -TERM -P "$pid" >/dev/null 2>&1 || true
  kill -TERM "$pid" >/dev/null 2>&1 || true
  sleep 1
  pkill -KILL -P "$pid" >/dev/null 2>&1 || true
  kill -KILL "$pid" >/dev/null 2>&1 || true
}

print_log_tail() {
  local label="$1"
  local file="$2"
  if [ ! -f "$file" ]; then
    return
  fi

  echo ""
  echo "---- $label log tail ----"
  tail -80 "$file" || true
  echo "---- end $label log tail ----"
}

wait_for_log() {
  local label="$1"
  local file="$2"
  local pattern="$3"
  local timeout_seconds="$4"
  local deadline=$((SECONDS + timeout_seconds))

  until grep -q "$pattern" "$file" 2>/dev/null; do
    assert_process_alive "$label"
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "Timed out waiting for $label log pattern: $pattern"
      print_log_tail "$label" "$file"
      exit 1
    fi
    sleep 1
  done
}

assert_process_alive() {
  local label="$1"
  local pid=""

  case "$label" in
    api) pid="$api_pid" ;;
    jobs) pid="$jobs_pid" ;;
    *) return ;;
  esac

  if [ -n "$pid" ] && ! kill -0 "$pid" >/dev/null 2>&1; then
    echo "$label process exited before tests completed."
    print_log_tail "$label" "$LOG_DIR/$label.log"
    exit 1
  fi
}

wait_for_api_readiness() {
  local readiness_url="$1"
  local deadline=$((SECONDS + API_READY_TIMEOUT_SECONDS))

  until curl --fail --silent --show-error "$readiness_url" >/dev/null 2>&1; do
    assert_process_alive api
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "Timed out waiting for API readiness at $readiness_url"
      print_log_tail api "$API_LOG"
      print_log_tail jobs "$JOBS_LOG"
      exit 1
    fi
    sleep 1
  done
}

try_postgres_connection() {
  local database_url="$1"
  DATABASE_URL="$database_url" node <<'NODE' >/dev/null 2>&1
const { Client } = require("pg");

const client = new Client({ connectionString: process.env.DATABASE_URL });
client
  .connect()
  .then(() => client.end())
  .catch(() => process.exit(1));
NODE
}

wait_for_postgres_url() {
  local database_url="$1"
  local timeout_seconds="$2"
  local deadline=$((SECONDS + timeout_seconds))

  until try_postgres_connection "$database_url"; do
    if [ "$SECONDS" -ge "$deadline" ]; then
      return 1
    fi
    sleep 1
  done
}

database_host_port() {
  local database_url="$1"
  DATABASE_URL="$database_url" node <<'NODE'
const url = new URL(process.env.DATABASE_URL);
console.log(`${url.hostname}:${url.port || "5432"}`);
NODE
}

database_url_with_port() {
  local database_url="$1"
  local port="$2"
  DATABASE_URL="$database_url" POSTGRES_PORT_OVERRIDE="$port" node <<'NODE'
const url = new URL(process.env.DATABASE_URL);
url.port = process.env.POSTGRES_PORT_OVERRIDE;
console.log(url.toString());
NODE
}

docker_postgres_host_port() {
  if ! command -v docker >/dev/null 2>&1; then
    return 1
  fi

  docker port mark-postgres 5432/tcp 2>/dev/null \
    | head -1 \
    | awk -F: '{print $NF}'
}

ensure_postgres_connection() {
  if wait_for_postgres_url "$DATABASE_URL" 5; then
    echo "Postgres is reachable at $(database_host_port "$DATABASE_URL")."
    return
  fi

  local docker_port
  docker_port="$(docker_postgres_host_port || true)"
  if [ -n "$docker_port" ]; then
    local docker_database_url
    docker_database_url="$(database_url_with_port "$DATABASE_URL" "$docker_port")"

    if wait_for_postgres_url "$docker_database_url" 15; then
      export DATABASE_URL="$docker_database_url"
      if [ -n "${DATABASE_URL_DIRECT:-}" ]; then
        export DATABASE_URL_DIRECT
        DATABASE_URL_DIRECT="$(database_url_with_port "$DATABASE_URL_DIRECT" "$docker_port")"
      fi
      echo "Postgres env port did not match the running container; using localhost:$docker_port for this test run."
      return
    fi
  fi

  echo "Postgres is not reachable at $(database_host_port "$DATABASE_URL")."
  echo "Run yarn db:down && yarn db if the existing mark-postgres container was created with stale port mappings."
  exit 1
}

require_command() {
  local command_name="$1"
  local install_hint="$2"

  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command: $command_name"
    echo "$install_hint"
    exit 1
  fi
}

trap cleanup EXIT INT TERM

require_command inso "Install Inso CLI with: brew install --cask inso"
require_command curl "Install curl and retry."
require_command jq "Install jq and retry."

if [ ! -f "$API_ENV_FILE" ]; then
  echo "Missing API env file: $API_ENV_FILE"
  exit 1
fi

if [ ! -f "$COLLECTION_FILE" ]; then
  echo "Missing Insomnia collection: $COLLECTION_FILE"
  exit 1
fi

set -a
# shellcheck source=/dev/null
source "$API_ENV_FILE"
set +a

API_PORT="${API_PORT:-4222}"
API_BASE_URL="${API_BASE_URL:-http://localhost:$API_PORT}"
API_READINESS_URL="$API_BASE_URL/health/readiness"

runtime_collection="$(mktemp -t mark-job-microservice)"

if ! jq -e --arg envName "$INSOMNIA_ENV" '.resources[] | select(._type == "environment" and .name == $envName)' "$COLLECTION_FILE" >/dev/null; then
  echo "Unknown Insomnia environment: $INSOMNIA_ENV"
  exit 1
fi

queue_header_value="${JOB_QUEUE_SECRET:-}" # pragma: allowlist secret

jq \
  --arg envName "$INSOMNIA_ENV" \
  --arg baseUrl "$API_BASE_URL" \
  --arg queueHeaderValue "$queue_header_value" \
  '(.resources[] | select(._type == "environment" and .name == $envName) | .data.base_url) = $baseUrl
   | (.resources[] | select(._type == "environment" and .name == $envName) | .data.job_queue_header_value) = $queueHeaderValue' \
  "$COLLECTION_FILE" > "$runtime_collection"

if lsof -Pi ":$API_PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "Port $API_PORT is already in use. Stop the existing API process before running yarn test:insomnia:jobs."
  exit 1
fi

mkdir -p "$LOG_DIR"
: > "$API_LOG"
: > "$JOBS_LOG"

echo "Starting local Redis/Postgres dependencies..."
(cd "$ROOT_DIR" && yarn db)
ensure_postgres_connection

echo "Starting jobs worker..."
(
  cd "$ROOT_DIR/apps/jobs"
  export JOB_WORKER_HEARTBEAT_INTERVAL_MS="${JOB_WORKER_HEARTBEAT_INTERVAL_MS:-1000}"
  export JOB_WORKER_HEARTBEAT_TTL_SECONDS="${JOB_WORKER_HEARTBEAT_TTL_SECONDS:-10}"
  exec yarn start
) >"$JOBS_LOG" 2>&1 &
jobs_pid=$!

wait_for_log jobs "$JOBS_LOG" "Jobs worker application context started" "$JOBS_READY_TIMEOUT_SECONDS"

echo "Starting Mark API..."
(
  cd "$ROOT_DIR/apps/api"
  export JOB_WORKER_CONNECT_RETRY_DELAY_MS="${JOB_WORKER_CONNECT_RETRY_DELAY_MS:-1000}"
  exec yarn start
) >"$API_LOG" 2>&1 &
api_pid=$!

wait_for_api_readiness "$API_READINESS_URL"
wait_for_log api "$API_LOG" "Connected to jobs worker" "$API_READY_TIMEOUT_SECONDS"

echo "Running Insomnia job microservice tests..."
inso run test "Job Microservice" \
  --env "$INSOMNIA_ENV" \
  --workingDir "$runtime_collection" \
  --ci \
  --bail \
  --requestTimeout "$INSOMNIA_REQUEST_TIMEOUT_MS"

echo "Insomnia job microservice tests completed."
