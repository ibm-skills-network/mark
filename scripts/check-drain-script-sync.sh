#!/usr/bin/env bash
set -euo pipefail
# The lti-sync-drain CronJob renders its script from a chart-local copy. The
# canonical copy stays at scripts/ for the manual-drain runbook. Keep identical.
canonical="scripts/lti-sync-drain.js"
chart_copy="helm-chart/mark-jobs/files/lti-sync-drain.js"
if ! diff -q "$canonical" "$chart_copy" >/dev/null 2>&1; then
  echo "ERROR: $chart_copy is out of sync with $canonical" >&2
  echo "Fix:   cp $canonical $chart_copy" >&2
  exit 1
fi
echo "lti-sync-drain script in sync"
