#!/bin/bash

set -euo pipefail
# Allow each backgrounded service to own a process group so cleanup can stop
# the full tree instead of only the parent shell wrapper.
set -m

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=scripts/server-common.sh
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/server-common.sh"

CHILD_PIDS=()
CHILD_NAMES=()

terminate_service_group() {
    local pid="$1"
    local name="$2"
    local attempts=0

    if ! kill -0 "${pid}" >/dev/null 2>&1; then
        return
    fi

    kill -- "-${pid}" >/dev/null 2>&1 || kill "${pid}" >/dev/null 2>&1 || true

    while kill -0 "${pid}" >/dev/null 2>&1 && [ "${attempts}" -lt 5 ]; do
        sleep 1
        attempts=$((attempts + 1))
    done

    if kill -0 "${pid}" >/dev/null 2>&1; then
        echo "⚠️  Force killing ${name}..."
        kill -KILL -- "-${pid}" >/dev/null 2>&1 || kill -KILL "${pid}" >/dev/null 2>&1 || true
    fi
}

cleanup() {
    local exit_code="$1"
    local index=0

    trap - EXIT INT TERM

    if [ ${#CHILD_PIDS[@]} -gt 0 ]; then
        echo ""
        echo "🛑 Stopping E2E servers..."
        while [ "${index}" -lt "${#CHILD_PIDS[@]}" ]; do
            local pid="${CHILD_PIDS[${index}]}"
            local name="${CHILD_NAMES[${index}]}"
            terminate_service_group "${pid}" "${name}"
            index=$((index + 1))
        done
        wait >/dev/null 2>&1 || true
    fi

    exit "${exit_code}"
}

trap 'cleanup $?' EXIT
trap 'cleanup 130' INT TERM

start_service() {
    local name="$1"
    shift

    echo "▶ Starting ${name}..."
    (
        exec "$@"
    ) &

    CHILD_PIDS+=("$!")
    CHILD_NAMES+=("${name}")
}

ensure_services_running() {
    local index=0

    while [ "${index}" -lt "${#CHILD_PIDS[@]}" ]; do
        local pid="${CHILD_PIDS[${index}]}"
        local name="${CHILD_NAMES[${index}]}"

        if ! kill -0 "${pid}" >/dev/null 2>&1; then
            echo "❌ ${name} exited before startup completed."
            wait "${pid}" || true
            return 1
        fi

        index=$((index + 1))
    done

    return 0
}

monitor_services() {
    while true; do
        ensure_services_running || return 1
        sleep 2
    done
}

echo "🚀 Starting E2E servers..."

run_server_preflight_checks

if [ -z "${CI:-}" ]; then
    echo "🏗️ Building API for E2E..."
    yarn --cwd "${REPO_ROOT}/apps/api" build
    echo "🏗️ Building API Gateway for E2E..."
    yarn --cwd "${REPO_ROOT}/apps/api-gateway" build
    echo "🏗️ Building web app for E2E..."
    yarn --cwd "${REPO_ROOT}/apps/web" build:e2e
fi

start_service "API" yarn --cwd "${REPO_ROOT}/apps/api" start:e2e
start_service "API Gateway" yarn --cwd "${REPO_ROOT}/apps/api-gateway" start:e2e
start_service "web app" yarn --cwd "${REPO_ROOT}/apps/web" start:e2e

wait_for_http_ready "Mark API" "${PW_MARK_API_BASE_URL:-http://127.0.0.1:${API_PORT:-4222}}/health/readiness" 120 ensure_services_running
wait_for_http_ready "API gateway" "${PW_GATEWAY_BASE_URL:-${API_GATEWAY_HOST:-http://127.0.0.1:${API_GATEWAY_PORT:-8000}}}/health/readiness" 120 ensure_services_running
wait_for_http_ready "web app" "${PW_WEB_BASE_URL:-http://localhost:${PORT:-3010}}" 120 ensure_services_running

echo "✅ E2E servers are ready."
monitor_services
