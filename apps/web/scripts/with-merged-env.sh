#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ROOT_ENV_FILE="${APP_ROOT}/../../dev.env"
LOCAL_ENV_FILE="${APP_ROOT}/.env.local"

require_env_file() {
    local file_path="$1"
    local label="$2"

    if [ -f "${file_path}" ]; then
        return
    fi

    echo "❌ Missing ${label} env file: ${file_path}"
    exit 1
}

cleanup() {
    if [ -n "${MERGED_ENV_FILE:-}" ]; then
        rm -f "${MERGED_ENV_FILE}"
    fi
}

trap cleanup EXIT

require_env_file "${ROOT_ENV_FILE}" "root"
require_env_file "${LOCAL_ENV_FILE}" "web local"

PATH="${APP_ROOT}/node_modules/.bin:${APP_ROOT}/../../node_modules/.bin:${PATH}"
export PATH

unset NODE_ENV

MERGED_ENV_FILE="$(mktemp "${TMPDIR:-/tmp}/mark-web-env.XXXXXX")"
# Let Next own NODE_ENV for dev/build/start so production-style commands do not
# inherit the shared development setting from dev.env.
{
    grep -Ev '^(export[[:space:]]+)?NODE_ENV=' "${ROOT_ENV_FILE}"
    grep -Ev '^(export[[:space:]]+)?NODE_ENV=' "${LOCAL_ENV_FILE}"
} > "${MERGED_ENV_FILE}"

cd "${APP_ROOT}"
dotenv -e "${MERGED_ENV_FILE}" -- "$@"
