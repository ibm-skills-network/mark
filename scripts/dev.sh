#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=scripts/server-common.sh
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/server-common.sh"

echo "🚀 Starting development servers..."

run_server_preflight_checks

echo "✅ All checks passed! Starting development servers..."
echo ""

(
    cd "${REPO_ROOT}"
    dotenv -e dev.env -- turbo run "${MARK_DEV_TASK:-dev}" --parallel
)
