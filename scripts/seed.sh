#!/bin/bash

set -e

SEED_SQL_PATH="seed.sql"
CONTAINER_NAME="mark-postgres"

echo "🌱 Starting database seeding process..."

# Source environment variables
if [ -f "dev.env" ]; then
    source dev.env
else
    echo "❌ Error: dev.env file not found!"
    echo "Please ensure dev.env exists in the project root."
    exit 1
fi

# Check if database container is running
if ! docker ps -q -f name="^${CONTAINER_NAME}$" | grep -q .; then
    echo "❌ Error: Database container is not running!"
    echo ""
    echo "Please run: yarn db"
    exit 1
fi

# Check if Prisma client has been generated (setup has been run)
if [ ! -d "apps/api/node_modules/.prisma" ] && [ ! -d "node_modules/.prisma" ]; then
    echo "❌ Error: Prisma client not generated!"
    echo ""
    echo "You need to run migrations first."
    echo "Please run: yarn setup"
    exit 1
fi

# Check if seed.sql exists
if [ -f "$SEED_SQL_PATH" ]; then
    echo "📁 Found seed.sql file - using pg_restore..."

    # Copy seed.sql to container
    echo "   → Copying seed.sql to container..."
    docker cp "$SEED_SQL_PATH" "$CONTAINER_NAME:/tmp/seed.sql"

    # Run pg_restore
    echo "   → Restoring database from seed.sql..."
    docker exec -i "$CONTAINER_NAME" pg_restore \
        --username=$POSTGRES_USER \
        --dbname=$POSTGRES_DB \
        --no-owner \
        --no-acl \
        --clean \
        --if-exists \
        --no-password \
        /tmp/seed.sql

    echo "✅ Database seeded successfully from seed.sql!"
else
    echo "📝 No seed.sql found - using TypeScript seed file..."

    # Check if node_modules exists
    if [ ! -d "node_modules" ]; then
        echo "❌ Error: node_modules not found!"
        echo ""
        echo "Please run: yarn"
        exit 1
    fi

    # Run TypeScript seed
    echo "   → Running prisma seed..."

    # Construct DATABASE_URL if not already set
    if [ -z "$DATABASE_URL" ]; then
        DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_EXTERNAL_PORT:-6001}/${POSTGRES_DB}"
        DATABASE_URL_DIRECT="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_EXTERNAL_PORT:-6001}/${POSTGRES_DB}"
    fi

    # Export for child processes
    export DATABASE_URL
    export DATABASE_URL_DIRECT

    cd apps/api
    # Run with explicit environment variables to ensure they're passed through
    DATABASE_URL="$DATABASE_URL" DATABASE_URL_DIRECT="$DATABASE_URL_DIRECT" npx prisma db seed
    cd ../..

    echo "✅ Database seeded successfully from seed.ts!"
fi

echo ""
echo "📋 Next steps:"
echo "   → Run 'yarn dev' to start the development servers"
