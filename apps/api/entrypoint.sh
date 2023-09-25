#!/bin/sh

# Run Prisma migrations
npx prisma migrate deploy

# Start the application
node dist/src/main.js