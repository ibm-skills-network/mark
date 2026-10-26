#!/usr/bin/env bash
set -euo pipefail
# The mark-jobs CronJobs render their scripts from chart-local copies. The
# canonical copies stay at scripts/ for the manual runbooks. Keep identical.
status=0
for name in lti-sync-drain db-retention; do
  canonical="scripts/$name.js"
  chart_copy="helm-chart/mark-jobs/files/$name.js"
  if ! diff -q "$canonical" "$chart_copy" >/dev/null 2>&1; then
    echo "ERROR: $chart_copy is out of sync with $canonical" >&2
    echo "Fix:   cp $canonical $chart_copy" >&2
    status=1
  fi
done
[ "$status" -eq 0 ] && echo "mark-jobs CronJob scripts in sync"
exit "$status"
