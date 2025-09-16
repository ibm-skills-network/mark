#!/bin/bash

set -e

CONTAINER_NAME="mark-postgres"
POSTGRES_PORT="6001"

echo "🔍 Checking database container status..."

# Check if container exists and is running
if docker ps -q -f name="^${CONTAINER_NAME}$" | grep -q .; then
    echo "✅ Database container is already running"
    echo "🔄 Resetting database to start fresh..."
    
    # Stop and remove the running container
    echo "   → Stopping container..."
    docker stop "$CONTAINER_NAME" >/dev/null
    echo "   → Removing container..."
    docker rm "$CONTAINER_NAME" >/dev/null
    
elif docker ps -aq -f name="^${CONTAINER_NAME}$" | grep -q .; then
    echo "⚠️  Database container exists but is not running"
    echo "   → Removing stopped container..."
    docker rm "$CONTAINER_NAME" >/dev/null
else
    echo "💡 No existing database container found"
fi

# Source environment variables
echo "🔧 Loading environment variables..."
if [ -f "dev.env" ]; then
    source dev.env
else
    echo "❌ Error: dev.env file not found!"
    exit 1
fi

# Check required environment variables
if [ -z "$POSTGRES_PASSWORD" ] || [ -z "$POSTGRES_USER" ] || [ -z "$POSTGRES_DB" ]; then
    echo "❌ Error: Missing required environment variables (POSTGRES_PASSWORD, POSTGRES_USER, POSTGRES_DB)"
    exit 1
fi

# Start new container
echo "🚀 Starting fresh database container..."
docker run \
    --name "$CONTAINER_NAME" \
    -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
    -e POSTGRES_USER="$POSTGRES_USER" \
    -e POSTGRES_DB="$POSTGRES_DB" \
    -p "${POSTGRES_PORT}:5432" \
    -d postgres >/dev/null

# Wait for the database to be ready
echo "⏳ Waiting for database to be ready..."
max_attempts=30
attempt=0

while [ $attempt -lt $max_attempts ]; do
    if docker exec "$CONTAINER_NAME" pg_isready -U "$POSTGRES_USER" >/dev/null 2>&1; then
        echo "✅ Database is ready!"
        break
    fi
    
    attempt=$((attempt + 1))
    echo "   → Attempt $attempt/$max_attempts - waiting..."
    sleep 1
done

if [ $attempt -eq $max_attempts ]; then
    echo "❌ Database failed to start within ${max_attempts} seconds"
    echo "📋 Container logs:"
    docker logs "$CONTAINER_NAME"
    exit 1
fi

echo "🎉 Database container '$CONTAINER_NAME' is running on host port $POSTGRES_PORT (mapped to container port 5432)"