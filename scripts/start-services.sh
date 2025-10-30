#!/bin/bash

echo " Starting Mark services (PostgreSQL + Redis)..."

if [ -f "dev.env" ]; then
    echo "Loading environment variables from dev.env..."
    set +e
    set -a
    source dev.env 2>/dev/null
    set +a
    set -e
fi

if ! docker info > /dev/null 2>&1; then
    echo "Error: Docker is not running. Please start Docker and try again."
    exit 1
fi

echo " Cleaning up existing containers..."
docker-compose -f docker-compose.yml down 2>/dev/null || true

echo " Removing any old standalone containers..."
docker stop mark-postgres mark-redis 2>/dev/null || true
docker rm mark-postgres mark-redis 2>/dev/null || true

echo "Starting PostgreSQL and Redis..."
docker-compose -f docker-compose.yml up -d

echo "Waiting for PostgreSQL to be ready..."
max_attempts=30
attempt=0

while [ $attempt -lt $max_attempts ]; do
    if docker exec mark-postgres pg_isready -U "${POSTGRES_USER:-mark-pg-user}" >/dev/null 2>&1; then
        echo "PostgreSQL is ready!"
        break
    fi

    attempt=$((attempt + 1))
    echo "   → Attempt $attempt/$max_attempts - waiting..."
    sleep 1
done

if [ $attempt -eq $max_attempts ]; then
    echo "PostgreSQL failed to start within ${max_attempts} seconds"
    echo "Container logs:"
    docker logs mark-postgres
    exit 1
fi

echo " Waiting for Redis to be ready..."
max_attempts=30
attempt=0

while [ $attempt -lt $max_attempts ]; do
    if docker exec mark-redis redis-cli ping >/dev/null 2>&1; then
        echo "Redis is ready!"
        break
    fi

    attempt=$((attempt + 1))
    echo "   → Attempt $attempt/$max_attempts - waiting..."
    sleep 1
done

if [ $attempt -eq $max_attempts ]; then
    echo " Redis failed to start within ${max_attempts} seconds"
    echo " Container logs:"
    docker logs mark-redis
    exit 1
fi

echo ""
echo " All services are running!"   
echo ""
echo "Service Status:"
echo "   PostgreSQL: localhost:${POSTGRES_PORT:-6001}"
echo "   Redis:      localhost:${REDIS_PORT:-6379}"
echo ""
echo " Useful commands:"
echo "   • Stop services:      yarn db:stop  (or docker-compose down)"
echo "   • View logs:          yarn db:logs  (or docker-compose logs -f)"
echo "   • Check status:       yarn db:status (or docker-compose ps)"
echo "   • Reset database:     yarn db (will restart fresh)"
echo "   • Connect to Postgres: docker exec -it mark-postgres psql -U ${POSTGRES_USER:-mark-pg-user} -d ${POSTGRES_DB:-mark-pg}"
echo "   • Connect to Redis:    docker exec -it mark-redis redis-cli"
echo ""
