#!/bin/sh

# Ensure the database exists
node ensureDb.js

# Run Prisma migrations
npx prisma migrate deploy

# Start the application
node dist/src/main.js
