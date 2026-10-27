ARG BASE_IMAGE=node:24-slim
ARG DIR=/usr/src/app

FROM ${BASE_IMAGE} AS builder
ARG DIR
WORKDIR ${DIR}

COPY . .
RUN yarn global add turbo@^2.0.3
RUN turbo prune apiv3 --docker && rm -f .npmrc

FROM ${BASE_IMAGE} AS installer
ARG DIR
WORKDIR ${DIR}

COPY --from=builder ${DIR}/out/json/ .
COPY --from=builder ${DIR}/yarn.lock ./yarn.lock
COPY --from=builder ${DIR}/turbo.json ./turbo.json
COPY --from=builder ${DIR}/packages ./packages
COPY --from=builder ${DIR}/apps/api/prisma ./apps/api/prisma
COPY --from=builder ${DIR}/patches ./patches

# The Prisma schema is owned by apps/api. yarn runs bins from the workspace
# root, where prisma finds no schema and exits 0, so pass it explicitly and
# fail the build if no client was generated.
# hadolint ignore=DL3008
RUN --mount=type=cache,target=/yarn-cache,sharing=locked \
    apt-get update -y \
  && apt-get install -y --no-install-recommends \
     python3 make g++ pkg-config openssl \
  && yarn install --frozen-lockfile --cache-folder /yarn-cache \
  && yarn prisma generate --schema=apps/api/prisma/schema.prisma \
  && test -f node_modules/.prisma/client/schema.prisma \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

FROM ${BASE_IMAGE} AS build
ARG DIR
WORKDIR ${DIR}

COPY --from=installer ${DIR}/ .
COPY --from=builder ${DIR}/out/full/ .

RUN yarn build --filter=apiv3

FROM ${BASE_IMAGE} AS production
ARG DIR
ENV NODE_ENV=production
WORKDIR ${DIR}

# hadolint ignore=DL3008
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends \
     dumb-init ca-certificates \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# Everything else is bundled into dist/; only the generated Prisma client
# (and its engine) is loaded from node_modules at runtime.
COPY --chown=node:node --from=installer ${DIR}/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --chown=node:node --from=installer ${DIR}/node_modules/.prisma ./node_modules/.prisma
COPY --chown=node:node --from=build ${DIR}/apps/apiv3/dist ./dist
COPY --chown=node:node --from=build ${DIR}/apps/apiv3/package.json ./package.json

# hadolint ignore=DL3066
USER node
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "dist/http.js"]
EXPOSE 3000 8081
