#!/bin/bash

echo "🧹 Cleaning up development ports..."

PORTS=(3010 4222 8000)

for port in "${PORTS[@]}"; do
    echo "Checking port $port..."

    PIDS=$(lsof -ti:$port 2>/dev/null || true)

    if [ -n "$PIDS" ]; then
        echo "  Found processes on port $port: $PIDS"
        echo "  Terminating processes..."
        echo "$PIDS" | xargs kill -TERM 2>/dev/null || true

        sleep 2

        REMAINING=$(lsof -ti:$port 2>/dev/null || true)
        if [ -n "$REMAINING" ]; then
            echo "  Force killing remaining processes..."
            echo "$REMAINING" | xargs kill -9 2>/dev/null || true
        fi

        echo "  ✅ Port $port cleaned"
    else
        echo "  ✅ Port $port is free"
    fi
done

echo "🎉 Port cleanup complete!"