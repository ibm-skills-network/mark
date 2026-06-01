ARG BASE_IMAGE=node:24-slim
ARG DIR=/usr/src/app

FROM ${BASE_IMAGE} AS builder
ARG DIR
WORKDIR ${DIR}

COPY . .
RUN yarn global add turbo@^2.0.3
RUN turbo prune api --docker && rm -f .npmrc

FROM ${BASE_IMAGE} AS installer
ARG DIR
WORKDIR ${DIR}

COPY --from=builder ${DIR}/out/json/ .
COPY --from=builder ${DIR}/yarn.lock ./yarn.lock
COPY --from=builder ${DIR}/turbo.json ./turbo.json
COPY --from=builder ${DIR}/packages ./packages
COPY --from=builder ${DIR}/apps/api/prisma ./apps/api/prisma
COPY --from=builder ${DIR}/patches ./patches

# hadolint ignore=DL3008
RUN --mount=type=cache,target=/yarn-cache,sharing=locked \
    apt-get update -y \
  && apt-get install -y --no-install-recommends \
     python3 make g++ pkg-config openssl \
  && yarn install --frozen-lockfile --cache-folder /yarn-cache \
  && yarn prisma generate \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

FROM ${BASE_IMAGE} AS build
ARG DIR
WORKDIR ${DIR}

COPY --from=installer ${DIR}/ .
COPY --from=builder ${DIR}/out/full/ .

RUN yarn build --filter=api

FROM ${BASE_IMAGE} AS production
ARG DIR
ENV NODE_ENV=production
WORKDIR ${DIR}

# hadolint ignore=DL3008
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends \
     dumb-init postgresql-client openssl ca-certificates \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

COPY --chown=node:node --from=installer ${DIR}/node_modules ./node_modules
COPY --chown=node:node --from=build ${DIR}/apps/api/dist ./dist
COPY --chown=node:node --from=build ${DIR}/apps/api/package.json ./package.json
COPY --chown=node:node --from=installer ${DIR}/apps/api/prisma ./prisma
COPY --chown=node:node --from=build ${DIR}/apps/api/migrate.sh ./migrate.sh
COPY --chown=node:node --from=build ${DIR}/apps/api/ensureDb.js ./ensureDb.js
COPY --chown=node:node --from=build ${DIR}/apps/api/src/scripts ./scripts

USER node
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "dist/main.js"]
EXPOSE 3000
