#!/bin/bash

# This script validates critical environment variables before starting the app

# Define critical environment variables
CRITICAL_ENV_VARS=(
    "POSTGRES_PASSWORD"
    "POSTGRES_USER"
    "POSTGRES_DB"
    "POSTGRES_HOST"
    "POSTGRES_PORT"
    "POSTGRES_EXTERNAL_PORT"
    "API_PORT"
    "API_GATEWAY_PORT"
    "API_GATEWAY_HOST"
    "PORT"
)

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

missing_vars=()

echo "🔍 Validating critical environment variables..."

# Source dev.env if it exists
if [ -f "dev.env" ]; then
    source dev.env
else
    echo -e "${RED}❌ Error: dev.env file not found!${NC}"
    echo ""
    echo "The dev.env file is required to run this application."
    echo ""
    echo "Steps to fix:"
    echo "  1. Check if dev.env exists in the project root"
    echo "  2. If not, create it or copy from dev.env.example (if available)"
    echo "  3. Ensure it contains all required environment variables"
    exit 1
fi

# Check each critical variable
for var in "${CRITICAL_ENV_VARS[@]}"; do
    if [ -z "${!var}" ]; then
        missing_vars+=("$var")
    fi
done

# Report results
if [ ${#missing_vars[@]} -eq 0 ]; then
    # Construct DATABASE_URL if not set
    if [ -z "$DATABASE_URL" ]; then
        export DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_EXTERNAL_PORT}/${POSTGRES_DB}"
        export DATABASE_URL_DIRECT="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_EXTERNAL_PORT}/${POSTGRES_DB}"
    fi
    echo -e "${GREEN}✅ All critical environment variables are set!${NC}"
    exit 0
else
    echo -e "${RED}❌ Missing critical environment variables:${NC}"
    echo ""
    for var in "${missing_vars[@]}"; do
        echo -e "   ${RED}✗${NC} $var"
    done
    echo ""
    echo "Steps to fix:"
    echo "  1. Open dev.env in your editor"
    echo "  2. Add the missing variables listed above"
    echo "  3. Refer to dev.env.example or documentation for correct values"
    echo ""
    echo "Example format:"
    echo "  export POSTGRES_USER=mark-pg-user"
    echo "  export POSTGRES_PASSWORD=mysecretpassword"
    exit 1
fi
