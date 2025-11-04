#!/bin/bash

set -e

CONTAINER_NAME="mark-postgres"
POSTGRES_EXTERNAL_PORT="6001"

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Error: Docker is not installed or not in PATH!"
    echo ""
    echo "Steps to fix:"
    echo "  1. Install Docker Desktop from https://www.docker.com/products/docker-desktop"
    echo "  2. Start Docker Desktop"
    echo "  3. Run this command again"
    exit 1
fi

# Check if docker-compose is installed
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null 2>&1; then
    echo "❌ Error: docker-compose is not installed!"
    echo ""
    echo "Steps to fix:"
    echo "  1. Docker Compose comes with Docker Desktop"
    echo "  2. If using Linux, install docker-compose-plugin"
    echo "  3. Run this command again"
    exit 1
fi

# Check if Docker daemon is running
if ! docker info &> /dev/null; then
    echo "❌ Error: Docker daemon is not running!"
    echo ""
    echo "Steps to fix:"
    echo "  1. Start Docker Desktop"
    echo "  2. Wait for Docker to fully start"
    echo "  3. Run this command again"
    exit 1
fi

echo "🔍 Checking database container status..."

# Source environment variables
if [ -f "dev.env" ]; then
    source dev.env
    export POSTGRES_USER
    export POSTGRES_PASSWORD
    export POSTGRES_DB
    export POSTGRES_EXTERNAL_PORT
else
    echo "⚠️  Warning: dev.env file not found, using defaults"
fi

# Check if the database port is already in use (but not by our container)
if ! docker ps -q -f name="^${CONTAINER_NAME}$" | grep -q .; then
    # Container is not running, check if port is occupied by something else
    if lsof -Pi :${POSTGRES_EXTERNAL_PORT:-6001} -sTCP:LISTEN -t >/dev/null 2>&1; then
        PROCESS_INFO=$(lsof -Pi :${POSTGRES_EXTERNAL_PORT:-6001} -sTCP:LISTEN | tail -n +2 | awk '{print $1, "(PID:", $2 ")"}')
        echo "❌ Error: Port ${POSTGRES_EXTERNAL_PORT:-6001} is already in use!"
        echo ""
        echo "Process using the port: $PROCESS_INFO"
        echo ""
        echo "Steps to fix:"
        echo "  1. Stop the process using port ${POSTGRES_EXTERNAL_PORT:-6001}"
        echo "  2. Or change POSTGRES_EXTERNAL_PORT in dev.env to a different port"
        echo "  3. Then run this command again"
        echo ""
        echo "To kill the process, run: kill -9 \$(lsof -ti:${POSTGRES_EXTERNAL_PORT:-6001})"
        exit 1
    fi
fi

# Check if container is already running
if docker ps -q -f name="^${CONTAINER_NAME}$" | grep -q .; then
    echo "✅ Database container is already running"
    echo ""
    echo "To restart with fresh data, run: docker-compose down -v && yarn db"
else
    # Start database using docker-compose
    echo "🚀 Starting database with docker-compose..."

    # Use docker compose (new) or docker-compose (legacy)
    if docker compose version &> /dev/null 2>&1; then
        COMPOSE_CMD="docker compose"
    else
        COMPOSE_CMD="docker-compose"
    fi

    $COMPOSE_CMD up -d postgres

    # Wait for the database to be ready
    echo "⏳ Waiting for database to be ready..."
    max_attempts=30
    attempt=0

    while [ $attempt -lt $max_attempts ]; do
        if docker exec "$CONTAINER_NAME" pg_isready -U "${POSTGRES_USER:-mark-pg-user}" >/dev/null 2>&1; then
            echo "✅ Database is ready!"
            break
        fi

        attempt=$((attempt + 1))
        echo "   → Attempt $attempt/$max_attempts - waiting..."
        sleep 1
    done

    if [ $attempt -eq $max_attempts ]; then
        echo "❌ Database failed to start within ${max_attempts} seconds"
        echo "Container logs:"
        docker logs "$CONTAINER_NAME"
        exit 1
    fi
fi

echo ""
echo "✅ Database container '$CONTAINER_NAME' is running on host port ${POSTGRES_EXTERNAL_PORT:-6001}"
echo ""
echo "📋 Next steps:"
echo "   → Run 'yarn setup' to run database migrations and generate Prisma client"
echo "   → Then run 'yarn seed' to seed the database with initial data"
echo ""
echo "💡 Useful commands:"
echo "   → Stop database: yarn db:stop"
echo "   → Stop and remove (keep data): yarn db:down"
echo "   → Stop and remove all data: yarn db:reset"
echo "   → View logs: yarn db:logs"