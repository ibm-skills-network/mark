#!/usr/bin/env bash
# Polls the live LTI grade sync queue.
#
# Streams scripts/lti-sync-diagnose.js into a running mark-api pod and
# executes it there (the pod is the only place @prisma/client and the
# DATABASE_URL are both available). Read-only against LtiGradeSync —
# safe to run against prod.
#
# Usage:
#   ./scripts/lti-sync-check.sh                  # auto-pick a mark-api pod
#   ./scripts/lti-sync-check.sh <pod-name>       # use a specific pod
#
# Prereq: kubectl must already point at the target cluster/namespace.
# For prod, run your `markprod` alias first.

set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
diag="$script_dir/lti-sync-diagnose.js"

if [[ ! -f "$diag" ]]; then
  echo "error: cannot find $diag" >&2
  exit 1
fi

pod="${1:-}"
if [[ -z "$pod" ]]; then
  pod=$(
    kubectl get pods -o jsonpath='{.items[?(@.status.phase=="Running")].metadata.name}' 2>/dev/null \
      | tr ' ' '\n' \
      | grep -E '^mark-api-[a-z0-9]+-[a-z0-9]+$' \
      | head -1 \
      || true
  )
fi

if [[ -z "$pod" ]]; then
  ctx=$(kubectl config current-context 2>/dev/null || echo 'unset')
  ns=$(kubectl config view --minify -o jsonpath='{..namespace}' 2>/dev/null || echo 'default')
  echo "error: no Running mark-api pod found (context=$ctx namespace=$ns)" >&2
  echo "       hint: did you run \`markprod\` (or your env's context alias)?" >&2
  exit 1
fi

echo "▶ lti-sync-diagnose via pod $pod" >&2

kubectl exec -i "$pod" -c mark-api \
  -- sh -c 'NODE_PATH=/usr/src/app/node_modules node' \
  < "$diag"
