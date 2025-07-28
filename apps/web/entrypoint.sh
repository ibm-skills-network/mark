#!/bin/sh
# Extract API_GATEWAY_HOST from environment variable
API_GATEWAY_HOST_VALUE=${API_GATEWAY_HOST}

# Replace placeholder text in the specified files
sed -i "s|http://{API_GATEWAY_HOST}|${API_GATEWAY_HOST_VALUE}|g" .next/required-server-files.json
sed -i "s|http://{API_GATEWAY_HOST}|${API_GATEWAY_HOST_VALUE}|g" .next/routes-manifest.json

# Start the Next.js application
yarn next start
