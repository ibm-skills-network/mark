#!/bin/bash

SERVER_COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SERVER_COMMON_DIR}/.." && pwd)"
DEV_ENV_FILE="${REPO_ROOT}/dev.env"
CONTAINER_NAME="mark-postgres"

# shellcheck source=scripts/check-port.sh
# shellcheck disable=SC1091
source "${SERVER_COMMON_DIR}/check-port.sh"

ensure_dependencies_installed() {
    if [ -d "${REPO_ROOT}/node_modules" ]; then
        return
    fi

    echo "❌ Error: Dependencies not installed!"
    echo ""
    echo "Please follow the setup process:"
    echo "  1. Run 'yarn' to install dependencies"
    echo "  2. Run 'yarn db' to start the database"
    echo "  3. Run 'yarn setup' to run migrations"
    echo "  4. Run 'yarn seed' to seed the database"
    echo "  5. Then run the command again"
    exit 1
}

ensure_database_running() {
    if [ -n "${CI:-}" ]; then
        return
    fi

    if docker ps -q -f name="^${CONTAINER_NAME}$" | grep -q .; then
        return
    fi

    echo "⚠️  Warning: Database container is not running!"
    echo ""
    echo "Please follow the setup process:"
    echo "  1. Run 'yarn db' to start the database"
    echo "  2. Run 'yarn setup' to run migrations"
    echo "  3. Run 'yarn seed' to seed the database"
    echo "  4. Then run the command again"
    exit 1
}

ensure_prisma_generated() {
    if [ -d "${REPO_ROOT}/apps/api/node_modules/.prisma" ] || [ -d "${REPO_ROOT}/node_modules/.prisma" ]; then
        return
    fi

    echo "⚠️  Warning: Prisma client not generated!"
    echo ""
    echo "Please run:"
    echo "  1. Run 'yarn setup' to run migrations and generate Prisma client"
    echo "  2. Run 'yarn seed' to seed the database"
    echo "  3. Then run the command again"
    exit 1
}

validate_environment() {
    (
        cd "${REPO_ROOT}" &&
        ./scripts/validate-env.sh
    )
}

load_dev_environment() {
    if [ ! -f "${DEV_ENV_FILE}" ]; then
        return
    fi

    # shellcheck disable=SC1090,SC1091
    source "${DEV_ENV_FILE}"
}

check_mark_ports_available() {
    echo "🔍 Checking if development ports are available..."

    local ports_in_use=()
    local port_processes=()
    local port
    local process_info

    port="${PORT:-3010}"
    if ! check_port "${port}"; then
        process_info=$(get_port_process "${port}")
        ports_in_use+=("${port} (Frontend/Web)")
        port_processes+=("  Port ${port}: ${process_info}")
    fi

    port="${API_PORT:-4222}"
    if ! check_port "${port}"; then
        process_info=$(get_port_process "${port}")
        ports_in_use+=("${port} (API)")
        port_processes+=("  Port ${port}: ${process_info}")
    fi

    port="${API_GATEWAY_PORT:-8000}"
    if ! check_port "${port}"; then
        process_info=$(get_port_process "${port}")
        ports_in_use+=("${port} (API Gateway)")
        port_processes+=("  Port ${port}: ${process_info}")
    fi

    if [ ${#ports_in_use[@]} -eq 0 ]; then
        return
    fi

    echo "❌ Error: Development ports are already in use!"
    echo ""
    echo "Ports in use:"
    for port in "${ports_in_use[@]}"; do
        echo "  ✗ ${port}"
    done
    echo ""
    echo "Processes using the ports:"
    for process_info in "${port_processes[@]}"; do
        echo "${process_info}"
    done
    echo ""
    echo "Steps to fix:"
    echo "  1. Stop the processes using these ports"
    echo "  2. Or change the port numbers in dev.env"
    echo "  3. Then run the command again"
    echo ""
    echo "To kill all processes on these ports, run:"
    for port in "${ports_in_use[@]}"; do
        local port_num
        port_num=$(echo "${port}" | awk '{print $1}')
        echo "  kill -9 \$(lsof -ti:${port_num})"
    done
    exit 1
}

run_server_preflight_checks() {
    ensure_dependencies_installed
    ensure_database_running
    ensure_prisma_generated
    validate_environment
    load_dev_environment
    check_mark_ports_available
}

wait_for_http_ready() {
    local label="$1"
    local url="$2"
    local timeout_seconds="${3:-120}"
    local readiness_guard="${4:-}"
    local elapsed=0

    echo "Waiting for ${label} at ${url}..."

    while [ "${elapsed}" -lt "${timeout_seconds}" ]; do
        if [ -n "${readiness_guard}" ] && ! "${readiness_guard}"; then
            return 1
        fi

        if curl --silent --show-error --fail --max-time 5 "${url}" >/dev/null 2>&1; then
            echo "✓ ${label} is ready"
            return 0
        fi

        sleep 1
        elapsed=$((elapsed + 1))
    done

    echo "❌ Timed out waiting for ${label} at ${url}"
    return 1
}
