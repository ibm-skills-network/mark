#!/bin/bash

# Helper function to check if a port is in use
# Usage: check_port <port> <service_name>

check_port() {
    local port=$1
    local service=$2

    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
        return 1  # Port is in use
    else
        return 0  # Port is free
    fi
}

# Get the process using a port
get_port_process() {
    local port=$1
    lsof -Pi :$port -sTCP:LISTEN | tail -n +2 | awk '{print $1, "(PID:", $2 ")"}'
}

# Export functions for use in other scripts
export -f check_port
export -f get_port_process
