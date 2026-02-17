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

  if npx prisma migrate deploy 2>&1 | tee /tmp/migrate-output.log; then
    echo "Migrations completed successfully on attempt $attempt"
    break
  else
    EXIT_CODE=$?

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