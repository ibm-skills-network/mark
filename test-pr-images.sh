#!/bin/bash

mkdir -p local-test

cat > local-test/api.Dockerfile << 'EOF'
# Using a consistent base for all stages
ARG BASE_IMAGE=node:20-alpine
FROM ${BASE_IMAGE} AS builder

ARG SN_GITHUB_NPM_TOKEN
ARG SN_GITHUB_NPM_REGISTRY=https://npm.pkg.github.com
ARG DIR=/usr/src/app

# Pruning using turbo
WORKDIR $DIR
COPY . .
RUN yarn global add turbo@^2.0.3
RUN echo "@ibm-skills-network:registry=$SN_GITHUB_NPM_REGISTRY" >> .npmrc && echo "//npm.pkg.github.com/:_authToken=$SN_GITHUB_NPM_TOKEN" >> .npmrc
RUN turbo prune api --docker && rm -f .npmrc

# Installing the isolated workspace
FROM ${BASE_IMAGE} AS installer
ARG DIR=/usr/src/app
WORKDIR $DIR
COPY --from=builder $DIR/out/json/ .
COPY --from=builder $DIR/out/yarn.lock ./yarn.lock
COPY --from=builder $DIR/turbo.json ./turbo.json
COPY --from=builder $DIR/packages ./packages
COPY --from=builder $DIR/apps/api/prisma ./prisma
# Install build dependencies and rebuild native modules
RUN apk add --no-cache python3 make g++ pkgconf \
  && yarn install --frozen-lockfile \
  && yarn prisma generate \
  && npm rebuild cld --build-from-source

# Running build using turbo
FROM ${BASE_IMAGE} AS sourcer
ARG DIR=/usr/src/app
WORKDIR $DIR
COPY --from=installer $DIR/ .
COPY --from=builder $DIR/out/full/ .
COPY --from=builder /usr/local/share/.config/yarn/global /usr/local/share/.config/yarn/global
RUN yarn build --filter=api && yarn install --production --ignore-scripts --frozen-lockfile

# Production stage
FROM ${BASE_IMAGE} AS production
ENV NODE_ENV production
ARG DIR=/usr/src/app
WORKDIR $DIR
RUN apk add --no-cache dumb-init postgresql-client
COPY --chown=node:node --from=sourcer $DIR/apps/api/dist ./dist
COPY --chown=node:node --from=sourcer $DIR/node_modules $DIR/node_modules
COPY --chown=node:node --from=sourcer $DIR/prisma ./prisma
COPY --chown=node:node --from=sourcer $DIR/apps/api/migrate.sh ./migrate.sh
COPY --chown=node:node --from=sourcer $DIR/apps/api/ensureDb.js ./ensureDb.js
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "dist/src/main.js"]
EXPOSE 3000

# Patched stage with updates
FROM production AS patched
USER root
RUN apk -U upgrade
USER node
EOF

cat > local-test/api-gateway.Dockerfile << 'EOF'
# Using a consistent base for all stages
ARG BASE_IMAGE=node:20-alpine
FROM ${BASE_IMAGE} AS builder

ARG SN_GITHUB_NPM_TOKEN
ARG SN_GITHUB_NPM_REGISTRY=https://npm.pkg.github.com
ARG DIR=/usr/src/app

# Pruning using turbo
WORKDIR $DIR
COPY . .
RUN yarn global add turbo@^2.0.3
RUN echo "@ibm-skills-network:registry=$SN_GITHUB_NPM_REGISTRY" >> .npmrc && echo "//npm.pkg.github.com/:_authToken=$SN_GITHUB_NPM_TOKEN" >> .npmrc
RUN turbo prune api-gateway --docker && rm -f .npmrc

# Installing the isolated workspace
FROM ${BASE_IMAGE} AS installer
ARG DIR=/usr/src/app
WORKDIR $DIR
COPY --from=builder $DIR/out/json/ .
COPY --from=builder $DIR/out/yarn.lock ./yarn.lock
COPY --from=builder $DIR/turbo.json ./turbo.json
COPY --from=builder $DIR/packages ./packages
RUN yarn install --ignore-scripts --frozen-lockfile

# Running build using turbo
FROM ${BASE_IMAGE} AS sourcer
ARG DIR=/usr/src/app
WORKDIR $DIR
COPY --from=installer $DIR/ .
COPY --from=builder $DIR/out/full/ .
COPY --from=builder /usr/local/share/.config/yarn/global /usr/local/share/.config/yarn/global
RUN yarn build --filter=api-gateway && yarn install --production --ignore-scripts --frozen-lockfile

# Production stage
FROM ${BASE_IMAGE} AS production
ARG DIR=/usr/src/app
ENV NODE_ENV production
WORKDIR $DIR
RUN apk add --no-cache dumb-init
COPY --chown=node:node --from=sourcer $DIR/apps/api-gateway/dist ./dist
COPY --chown=node:node --from=sourcer $DIR/node_modules $DIR/node_modules
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "dist/main.js"]
EXPOSE 3000

# Patched stage with updates
FROM production AS patched
USER root
RUN apk -U upgrade
USER node
EOF

cat > local-test/ui.Dockerfile << 'EOF'
# Using a consistent base for all stages
ARG BASE_IMAGE=node:20-alpine
FROM ${BASE_IMAGE} AS builder

ARG SN_GITHUB_NPM_TOKEN
ARG SN_GITHUB_NPM_REGISTRY=https://npm.pkg.github.com
ARG DIR=/usr/src/app

# Pruning using turbo for the Next.js app
WORKDIR $DIR
COPY . .
RUN yarn global add turbo@^2.0.3
RUN echo "@ibm-skills-network:registry=$SN_GITHUB_NPM_REGISTRY" >> .npmrc && echo "//npm.pkg.github.com/:_authToken=$SN_GITHUB_NPM_TOKEN" >> .npmrc
RUN turbo prune web --docker && rm -f .npmrc

# Installing the isolated workspace for the Next.js app
FROM ${BASE_IMAGE} AS installer
ARG DIR=/usr/src/app
WORKDIR $DIR
COPY --from=builder $DIR/ .
COPY --from=builder /usr/local/share/.config/yarn/global /usr/local/share/.config/yarn/global
RUN yarn install --ignore-scripts --frozen-lockfile && yarn cache clean

# Running build using turbo for the Next.js app
FROM installer AS sourcer
WORKDIR $DIR
COPY --from=builder /usr/local/share/.config/yarn/global /usr/local/share/.config/yarn/global
RUN yarn build --filter=web && yarn install --production --ignore-scripts --frozen-lockfile && yarn cache clean

# Production stage
FROM ${BASE_IMAGE} AS production
ARG DIR=/usr/src/app
ENV NODE_ENV production
WORKDIR $DIR
RUN apk add --no-cache dumb-init
COPY --chown=node:node --from=sourcer $DIR/apps/web/.next ./.next
COPY --chown=node:node --from=sourcer $DIR/package.json $DIR/package.json
COPY --chown=node:node --from=sourcer $DIR/node_modules $DIR/node_modules
COPY --chown=node:node --from=sourcer $DIR/apps/web/public ./public
COPY --chown=node:node --from=sourcer $DIR/apps/web/entrypoint.sh ./entrypoint.sh
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["./entrypoint.sh"]
EXPOSE 3000

# Patched stage with updates
FROM production AS patched
USER root
RUN apk -U upgrade
USER node
EOF

cat > docker-compose.local-test.yml << 'EOF'
version: '3.8'

services:
  # Service to build API Gateway image
  api-gateway-build:
    build:
      context: .
      dockerfile: ./local-test/api-gateway.Dockerfile
      target: patched
      args:
        SN_GITHUB_NPM_TOKEN: ${SN_GITHUB_NPM_TOKEN:-dummy-token}
    image: local/mark-api-gateway:pr-test
    container_name: mark-api-gateway-test
    command: ["echo", "API Gateway image built successfully"]
    profiles: ["build"]

  # Service to build API image
  api-build:
    build:
      context: .
      dockerfile: ./local-test/api.Dockerfile
      target: patched
      args:
        SN_GITHUB_NPM_TOKEN: ${SN_GITHUB_NPM_TOKEN:-dummy-token}
    image: local/mark-api:pr-test
    container_name: mark-api-test
    command: ["echo", "API image built successfully"]
    profiles: ["build"]

  # Service to build UI image
  ui-build:
    build:
      context: .
      dockerfile: ./local-test/ui.Dockerfile
      target: patched
      args:
        SN_GITHUB_NPM_TOKEN: ${SN_GITHUB_NPM_TOKEN:-dummy-token}
    image: local/mark-ui:pr-test
    container_name: mark-ui-test
    command: ["echo", "UI image built successfully"]
    profiles: ["build"]

  # Services for actually running the applications once built
  api-gateway:
    image: local/mark-api-gateway:pr-test
    ports:
      - "8080:8080"
    depends_on:
      api-gateway-build:
        condition: service_completed_successfully
    container_name: mark-api-gateway-running
    profiles: ["run"]

  api:
    image: local/mark-api:pr-test
    ports:
      - "3000:3000"
    depends_on:
      api-build:
        condition: service_completed_successfully
    container_name: mark-api-running
    profiles: ["run"]

  ui:
    image: local/mark-ui:pr-test
    ports:
      - "80:80"
    depends_on:
      ui-build:
        condition: service_completed_successfully
    container_name: mark-ui-running
    profiles: ["run"]
EOF

# Set variables similar to what GitHub Actions would set
export PR_NUMBER="local"
export SHORT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "localtest")
export BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "local-branch" | sed 's/[^a-zA-Z0-9]/-/g')

echo "====================================================="
echo "🔍 Testing PR Image Builds Locally"
echo "📌 Branch: $BRANCH_NAME"
echo "📌 Commit: $SHORT_SHA"
echo "====================================================="

# Check if we need to enter a GitHub token
if [ -z "$SN_GITHUB_NPM_TOKEN" ]; then
    echo "⚠️  No SN_GITHUB_NPM_TOKEN environment variable found."
    echo "   If your build requires access to private npm packages,"
    echo "   you should set this variable before running this script."
    echo ""
    read -p "Would you like to enter a GitHub token now? (y/n): " TOKEN_ANSWER
    
    if [[ $TOKEN_ANSWER == "y" || $TOKEN_ANSWER == "Y" ]]; then
        read -sp "Enter your GitHub token: " SN_GITHUB_NPM_TOKEN
        echo ""
        export SN_GITHUB_NPM_TOKEN
    else
        echo "Continuing without a token. This may fail if your build needs private packages."
    fi
fi

# Ask which services to build
echo "Which services would you like to build?"
echo "1. All services"
echo "2. API Gateway only"
echo "3. API only"
echo "4. UI only"
read -p "Enter your choice (1-4): " BUILD_CHOICE

# Build the images
echo "🏗️  Building Docker images..."

case $BUILD_CHOICE in
    1)
        echo "Building all services..."
        docker-compose -f docker-compose.local-test.yml --profile build up --build
        ;;
    2)
        echo "Building API Gateway only..."
        docker-compose -f docker-compose.local-test.yml up --build api-gateway-build
        ;;
    3)
        echo "Building API only..."
        docker-compose -f docker-compose.local-test.yml up --build api-build
        ;;
    4)
        echo "Building UI only..."
        docker-compose -f docker-compose.local-test.yml up --build ui-build
        ;;
    *)
        echo "Invalid choice. Exiting."
        exit 1
        ;;
esac

# Check build status
BUILD_STATUS=$?
if [ $BUILD_STATUS -ne 0 ]; then
    echo "❌ Docker build failed with exit code $BUILD_STATUS"
    exit $BUILD_STATUS
fi

echo "✅ Images built successfully!"
echo "====================================================="
echo "🐳 Images available locally:"

if [[ $BUILD_CHOICE == "1" || $BUILD_CHOICE == "2" ]]; then
    echo "- local/mark-api-gateway:pr-test"
fi
if [[ $BUILD_CHOICE == "1" || $BUILD_CHOICE == "3" ]]; then
    echo "- local/mark-api:pr-test"
fi
if [[ $BUILD_CHOICE == "1" || $BUILD_CHOICE == "4" ]]; then
    echo "- local/mark-ui:pr-test"
fi

echo "====================================================="

# Ask if user wants to run the containers
read -p "Would you like to run the containers to test them? (y/n): " RUN_ANSWER

if [[ $RUN_ANSWER == "y" || $RUN_ANSWER == "Y" ]]; then
    echo "🚀 Starting containers..."
    
    case $BUILD_CHOICE in
        1)
            docker-compose -f docker-compose.local-test.yml --profile run up -d
            echo "✅ All containers are running."
            ;;
        2)
            docker-compose -f docker-compose.local-test.yml up -d api-gateway
            echo "✅ API Gateway is running at http://localhost:8080"
            ;;
        3)
            docker-compose -f docker-compose.local-test.yml up -d api
            echo "✅ API is running at http://localhost:3000"
            ;;
        4)
            docker-compose -f docker-compose.local-test.yml up -d ui
            echo "✅ UI is running at http://localhost:80"
            ;;
    esac
    
    echo "====================================================="
    echo "Use the following command to stop the containers:"
    echo "docker-compose -f docker-compose.local-test.yml --profile run down"
fi

# Create the GitHub workflow file for PR image builds
mkdir -p .github/workflows

cat > .github/workflows/build-pr-images.yml << 'EOF'
name: Build and Publish PR Images

on:
  pull_request:
    branches:
      - master
    types: [opened, synchronize, reopened]

jobs:
  build_and_publish_pr_images:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
      pull-requests: write
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v3
        with:
          fetch-depth: 0
      
      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v2
      
      - name: Login to GitHub Container Registry
        uses: docker/login-action@v2
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      
      - name: Extract PR metadata
        id: pr_metadata
        run: |
          echo "PR_NUMBER=${{ github.event.pull_request.number }}" >> $GITHUB_ENV
          echo "SHORT_SHA=$(git rev-parse --short ${{ github.event.pull_request.head.sha }})" >> $GITHUB_ENV
          echo "BRANCH_NAME=$(echo ${{ github.event.pull_request.head.ref }} | sed 's/[^a-zA-Z0-9]/-/g')" >> $GITHUB_ENV
      
      - name: Build and push API Gateway image
        uses: docker/build-push-action@v4
        with:
          context: .
          file: apps/api-gateway/Dockerfile
          target: patched
          build-args: |
            BASE_IMAGE=node:20-alpine
            SN_GITHUB_NPM_TOKEN=${{ secrets.SN_GITHUB_NPM_TOKEN }}
          push: true
          tags: |
            ghcr.io/${{ github.repository }}/mark-api-gateway:pr-${{ env.PR_NUMBER }}-${{ env.SHORT_SHA }}