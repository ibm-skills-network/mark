#!/bin/sh
set -e

# Ensure the database exists
node ensureDb.js

MAX_RETRIES=5
RETRY_DELAY=5
attempt=1
echo "Running Prisma migrations (will retry up to $MAX_RETRIES times on advisory lock timeouts)..."

while [ $attempt -le $MAX_RETRIES ]; do
  echo "Migration attempt $attempt of $MAX_RETRIES..."

  # No pipe here: `prisma | tee` would make the if test tee's exit code, so a
  # failed migrate (e.g. P3009 unresolved failed migration) reports success.
  EXIT_CODE=0
  npx prisma migrate deploy > /tmp/migrate-output.log 2>&1 || EXIT_CODE=$?
  cat /tmp/migrate-output.log

  if [ "$EXIT_CODE" -eq 0 ]; then
    echo "Migrations completed successfully on attempt $attempt"
    break
  else
    if grep -q "P1002" /tmp/migrate-output.log && grep -q "advisory lock" /tmp/migrate-output.log; then
      if [ $attempt -lt $MAX_RETRIES ]; then
        echo "Advisory lock timeout detected. Waiting ${RETRY_DELAY}s before retry..."
        sleep $RETRY_DELAY
        RETRY_DELAY=$((RETRY_DELAY * 2))
        attempt=$((attempt + 1))
      else
        echo "Failed to acquire advisory lock after $MAX_RETRIES attempts"
        exit $EXIT_CODE
      fi
    else
      echo "Migration failed with non-advisory-lock error"
      exit $EXIT_CODE
    fi
  fi
done
rm -f /tmp/migrate-output.log