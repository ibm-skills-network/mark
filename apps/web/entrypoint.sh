#!/bin/sh
set -eu

if [ -z "${API_GATEWAY_HOST:-}" ]; then
    echo "❌ API_GATEWAY_HOST must be set before starting the web app."
    exit 1
fi

node ./scripts/prepare-next-start.js

# Start the Next.js application
exec yarn next start
