#!/bin/sh
set -e

# Ensure the database exists
node ensureDb.js

# If the previous command fails, the script will exit immediately
# because of the `set -e` command above.

# Run Prisma migrations
npx prisma migrate deploy