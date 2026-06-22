#!/usr/bin/env bash
# Read-only lookup of a learner's attempts/submissions for one assignment.
#
# "Course id" / "quiz id" in support requests is the Assignment.id. Streams
# scripts/check-submissions.js into a running mark-api pod and executes it there
# (the pod is the only place @prisma/client and DATABASE_URL are both
# available). Read-only — only findUnique/findMany, ZERO writes. Safe to run
# against production.
#
# Usage:
#   ./scripts/check-submissions.sh <email> <assignmentId> [pod-name]
#
# Examples:
#   ./scripts/check-submissions.sh learner@ibm.com 3337
#   ./scripts/check-submissions.sh learner@ibm.com 3337 mark-api-557bff9f8-dp6bt
#
# Prereq: kubectl must already point at the target cluster/namespace.
# For prod, run your `markprod` alias first.

set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
diag="$script_dir/check-submissions.js"

email="${1:-}"
assignment="${2:-}"
pod="${3:-}"

if [[ -z "$email" || -z "$assignment" ]]; then
  echo "usage: $(basename "$0") <email> <assignmentId> [pod-name]" >&2
  exit 1
fi

# Validate inputs before they reach the cluster. Defensive even though the
# values are passed as discrete argv (via `env`), not interpolated into a shell.
if [[ ! "$assignment" =~ ^[0-9]+$ ]]; then
  echo "error: assignmentId must be a positive integer (got '$assignment')" >&2
  exit 1
fi
if [[ ! "$email" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then
  echo "error: '$email' does not look like an email address" >&2
  exit 1
fi

if [[ ! -f "$diag" ]]; then
  echo "error: cannot find $diag" >&2
  exit 1
fi

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

echo "▶ check-submissions.js via pod $pod (user=$email assignment=$assignment)" >&2

# Pass params as discrete argv via `env` — no shell-string interpolation, so the
# email/id can't break out into the remote shell.
kubectl exec -i "$pod" -c mark-api \
  -- env NODE_PATH=/usr/src/app/node_modules \
         CHK_USER="$email" \
         CHK_ASSIGNMENT="$assignment" \
         node \
  < "$diag"
