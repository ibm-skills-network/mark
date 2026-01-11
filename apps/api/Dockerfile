# Using a consistent base for all stages
ARG BASE_IMAGE=node:22-slim
# hadolint ignore=DL3006
FROM ${BASE_IMAGE} AS builder

ARG DIR=/usr/src/app

# Copy package files for dependency resolution
WORKDIR $DIR
COPY . .
RUN yarn global add turbo@^2.0.3
RUN turbo prune api --docker && rm -f .npmrc

# Installing the isolated workspace
# hadolint ignore=DL3006
FROM ${BASE_IMAGE} AS installer
ARG DIR=/usr/src/app
WORKDIR $DIR
COPY --from=builder $DIR/out/json/ .
COPY --from=builder $DIR/out/yarn.lock ./yarn.lock
COPY --from=builder $DIR/turbo.json ./turbo.json
COPY --from=builder $DIR/packages ./packages
COPY --from=builder $DIR/apps/api/prisma ./prisma

# Install build dependencies, OpenSSL, and rebuild native modules
# hadolint ignore=DL3008
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends \
     python3 make g++ pkg-config openssl \
  && yarn install --frozen-lockfile \
  && yarn prisma generate \
  && npm rebuild cld --build-from-source \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

# Running build using turbo
# hadolint ignore=DL3006
FROM ${BASE_IMAGE} AS sourcer
ARG DIR=/usr/src/app
WORKDIR $DIR
COPY --from=installer $DIR/ .
COPY --from=builder $DIR/out/full/ .
COPY --from=builder /usr/local/share/.config/yarn/global /usr/local/share/.config/yarn/global
RUN yarn build --filter=api && yarn install --production --ignore-scripts --frozen-lockfile

# Production stage
# hadolint ignore=DL3006
FROM ${BASE_IMAGE} AS production
ENV NODE_ENV=production
ARG DIR=/usr/src/app
WORKDIR $DIR

# Install runtime deps including OpenSSL
# hadolint ignore=DL3008
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends \
     dumb-init postgresql-client openssl \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

COPY --chown=node:node --from=sourcer $DIR/apps/api/package.json ./package.json
COPY --chown=node:node --from=sourcer $DIR/apps/api/dist ./dist
COPY --chown=node:node --from=sourcer $DIR/node_modules $DIR/node_modules
COPY --chown=node:node --from=sourcer $DIR/prisma ./prisma
COPY --chown=node:node --from=sourcer $DIR/apps/api/migrate.sh ./migrate.sh
COPY --chown=node:node --from=sourcer $DIR/apps/api/ensureDb.js ./ensureDb.js
COPY --chown=node:node --from=sourcer $DIR/apps/api/src/scripts ./scripts

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "dist/src/main.js"]
EXPOSE 3000

# Patched stage with updates
FROM production AS patched
USER root
RUN apt-get update -y && apt-get upgrade -y && apt-get clean && rm -rf /var/lib/apt/lists/*
USER node
