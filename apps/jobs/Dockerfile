ARG BASE_IMAGE=node:24-slim
ARG DIR=/usr/src/app

FROM ${BASE_IMAGE} AS builder
ARG DIR
WORKDIR ${DIR}

COPY . .
RUN yarn global add turbo@^2.0.3
RUN turbo prune jobs --docker && rm -f .npmrc

FROM ${BASE_IMAGE} AS installer
ARG DIR
WORKDIR ${DIR}

COPY --from=builder ${DIR}/out/json/ .
COPY --from=builder ${DIR}/yarn.lock ./yarn.lock
COPY --from=builder ${DIR}/turbo.json ./turbo.json
COPY --from=builder ${DIR}/packages ./packages

# hadolint ignore=DL3008
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends \
     python3 make g++ pkg-config openssl \
  && yarn install --ignore-scripts --frozen-lockfile \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

FROM ${BASE_IMAGE} AS build
ARG DIR
WORKDIR ${DIR}

COPY --from=installer ${DIR}/ .
COPY --from=builder ${DIR}/out/full/ .

RUN yarn build --filter=jobs

FROM ${BASE_IMAGE} AS production
ARG DIR
ENV NODE_ENV=production
WORKDIR ${DIR}

# hadolint ignore=DL3008
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends \
     dumb-init openssl ca-certificates \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

COPY --chown=node:node --from=installer ${DIR}/node_modules ./node_modules
COPY --chown=node:node --from=build ${DIR}/apps/jobs/dist ./dist
COPY --chown=node:node --from=build ${DIR}/apps/jobs/package.json ./package.json

USER node
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "dist/src/main.js"]
