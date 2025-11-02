#!/bin/bash

set -e

CONTAINER_NAME="mark-postgres"

echo "⚙️  Setting up database schema and Prisma client..."

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "❌ Error: Dependencies not installed!"
    echo ""
    echo "Steps to fix:"
    echo "  1. Run 'yarn' to install dependencies"
    echo "  2. Then run this command again"
    exit 1
fi

# Check if database container is running
if ! docker ps -q -f name="^${CONTAINER_NAME}$" | grep -q .; then
    echo "❌ Error: Database container is not running!"
    echo ""
    echo "Steps to fix:"
    echo "  1. Run 'yarn db' to start the database"
    echo "  2. Then run this command again"
    exit 1
fi

# Validate environment variables
echo "🔍 Validating environment variables..."
if ! ./scripts/validate-env.sh; then
    exit 1
fi

# Run Prisma migrations and generate client
cd apps/api

# Source environment variables and construct DATABASE_URL if needed
if [ -f "../../dev.env" ]; then
    source ../../dev.env
    if [ -z "$DATABASE_URL" ]; then
        export DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_EXTERNAL_PORT:-6001}/${POSTGRES_DB}"
        export DATABASE_URL_DIRECT="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_EXTERNAL_PORT:-6001}/${POSTGRES_DB}"
    fi
fi

echo "📊 Running Prisma migrations..."
# Check if there are pending migrations or if database is empty
MIGRATE_STATUS=$(npx prisma migrate status 2>&1 || true)
if echo "$MIGRATE_STATUS" | grep -q "Database schema is up to date"; then
    echo "   → Database schema is up to date, skipping migrations"
elif echo "$MIGRATE_STATUS" | grep -q "No migration found"; then
    # First time setup - run migrations with default name
    npx prisma migrate dev --name init --skip-seed
else
    # Has pending migrations - deploy them
    npx prisma migrate deploy || npx prisma migrate dev --name auto_migration --skip-seed
fi

echo "🔄 Generating Prisma client..."
npx prisma generate
cd ../..

echo ""
echo "✅ Setup completed successfully!"
echo ""
echo "📋 Next steps:"
echo "   → Run 'yarn seed' to seed the database with initial data"
echo "   → Then run 'yarn dev' to start the development servers"
