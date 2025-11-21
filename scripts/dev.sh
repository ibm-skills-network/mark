#!/bin/bash

set -e

CONTAINER_NAME="mark-postgres"

echo "🚀 Starting development servers..."

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "❌ Error: Dependencies not installed!"
    echo ""
    echo "Please follow the setup process:"
    echo "  1. Run 'yarn' to install dependencies"
    echo "  2. Run 'yarn db' to start the database"
    echo "  3. Run 'yarn setup' to run migrations"
    echo "  4. Run 'yarn seed' to seed the database"
    echo "  5. Then run 'yarn dev' again"
    exit 1
fi

# Check if database container is running
if ! docker ps -q -f name="^${CONTAINER_NAME}$" | grep -q .; then
    echo "⚠️  Warning: Database container is not running!"
    echo ""
    echo "Please follow the setup process:"
    echo "  1. Run 'yarn db' to start the database"
    echo "  2. Run 'yarn setup' to run migrations"
    echo "  3. Run 'yarn seed' to seed the database"
    echo "  4. Then run 'yarn dev' again"
    exit 1
fi

# Check if Prisma client is generated
if [ ! -d "apps/api/node_modules/.prisma" ] && [ ! -d "node_modules/.prisma" ]; then
    echo "⚠️  Warning: Prisma client not generated!"
    echo ""
    echo "Please run:"
    echo "  1. Run 'yarn setup' to run migrations and generate Prisma client"
    echo "  2. Run 'yarn seed' to seed the database"
    echo "  3. Then run 'yarn dev' again"
    exit 1
fi

# Validate environment variables
if ! ./scripts/validate-env.sh; then
    exit 1
fi

# Source environment variables to get port numbers
if [ -f "dev.env" ]; then
    source dev.env
fi

# Check if development ports are in use
echo "🔍 Checking if development ports are available..."

PORTS_IN_USE=()
PORT_PROCESSES=()

# Check frontend port (PORT)
if lsof -Pi :${PORT:-3010} -sTCP:LISTEN -t >/dev/null 2>&1; then
    PROCESS_INFO=$(lsof -Pi :${PORT:-3010} -sTCP:LISTEN | tail -n +2 | awk '{print $1, "(PID:", $2 ")"}')
    PORTS_IN_USE+=("${PORT:-3010} (Frontend/Web)")
    PORT_PROCESSES+=("  Port ${PORT:-3010}: $PROCESS_INFO")
fi

# Check API port (API_PORT)
if lsof -Pi :${API_PORT:-4222} -sTCP:LISTEN -t >/dev/null 2>&1; then
    PROCESS_INFO=$(lsof -Pi :${API_PORT:-4222} -sTCP:LISTEN | tail -n +2 | awk '{print $1, "(PID:", $2 ")"}')
    PORTS_IN_USE+=("${API_PORT:-4222} (API)")
    PORT_PROCESSES+=("  Port ${API_PORT:-4222}: $PROCESS_INFO")
fi

# Check API Gateway port (API_GATEWAY_PORT)
if lsof -Pi :${API_GATEWAY_PORT:-8000} -sTCP:LISTEN -t >/dev/null 2>&1; then
    PROCESS_INFO=$(lsof -Pi :${API_GATEWAY_PORT:-8000} -sTCP:LISTEN | tail -n +2 | awk '{print $1, "(PID:", $2 ")"}')
    PORTS_IN_USE+=("${API_GATEWAY_PORT:-8000} (API Gateway)")
    PORT_PROCESSES+=("  Port ${API_GATEWAY_PORT:-8000}: $PROCESS_INFO")
fi

# If any ports are in use, show error and exit
if [ ${#PORTS_IN_USE[@]} -gt 0 ]; then
    echo "❌ Error: Development ports are already in use!"
    echo ""
    echo "Ports in use:"
    for port in "${PORTS_IN_USE[@]}"; do
        echo "  ✗ $port"
    done
    echo ""
    echo "Processes using the ports:"
    for process in "${PORT_PROCESSES[@]}"; do
        echo "$process"
    done
    echo ""
    echo "Steps to fix:"
    echo "  1. Stop the processes using these ports"
    echo "  2. Or change the port numbers in dev.env"
    echo "  3. Then run 'yarn dev' again"
    echo ""
    echo "To kill all processes on these ports, run:"
    for port in "${PORTS_IN_USE[@]}"; do
        PORT_NUM=$(echo "$port" | awk '{print $1}')
        echo "  kill -9 \$(lsof -ti:$PORT_NUM)"
    done
    exit 1
fi

echo "✅ All checks passed! Starting development servers..."
echo ""

# Start the dev servers
dotenv -e dev.env -- turbo run dev --parallel
