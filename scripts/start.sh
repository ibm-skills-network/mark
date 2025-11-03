#!/bin/bash

set -e

echo "🚀 Starting Mark project setup and development..."
echo ""
echo "This script will run all necessary setup steps:"
echo "  1. Install dependencies (yarn)"
echo "  2. Start database (yarn db)"
echo "  3. Run migrations (yarn setup)"
echo "  4. Seed database (yarn seed)"
echo "  5. Start dev servers (yarn dev)"
echo ""

# Check if we should skip steps
SKIP_INSTALL=false
SKIP_DB=false
SKIP_SETUP=false
SKIP_SEED=false

# Check if node_modules exists
if [ -d "node_modules" ]; then
    echo "✅ Dependencies already installed, skipping yarn install"
    SKIP_INSTALL=true
fi

# Check if database is running
if docker ps -q -f name="^mark-postgres$" | grep -q .; then
    echo "✅ Database already running, skipping yarn db"
    SKIP_DB=true
fi

# Step 1: Install dependencies
if [ "$SKIP_INSTALL" = false ]; then
    echo ""
    echo "📦 Step 1/5: Installing dependencies..."
    yarn install
else
    echo ""
    echo "⏭️  Step 1/5: Skipped (already installed)"
fi

# Step 2: Start database
if [ "$SKIP_DB" = false ]; then
    echo ""
    echo "🗄️  Step 2/5: Starting database..."
    yarn db
else
    echo ""
    echo "⏭️  Step 2/5: Skipped (already running)"
fi

# Step 3: Run migrations
echo ""
echo "⚙️  Step 3/5: Running migrations..."
yarn setup

# Step 4: Seed database
echo ""
echo "🌱 Step 4/5: Seeding database..."
yarn seed

# Step 5: Start dev servers
echo ""
echo "🎉 Setup complete! Starting development servers..."
echo ""
yarn dev
