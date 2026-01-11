ARG BASE_IMAGE=node:24-alpine
ARG DIR=/usr/src/app

FROM ${BASE_IMAGE} AS builder
WORKDIR ${DIR}

COPY . .
RUN yarn global add turbo@^2.0.3
RUN turbo prune web --docker && rm -f .npmrc


FROM ${BASE_IMAGE} AS installer
WORKDIR ${DIR}

COPY --from=builder ${DIR}/out/json/ .
COPY --from=builder ${DIR}/out/yarn.lock ./yarn.lock
COPY --from=builder ${DIR}/turbo.json ./turbo.json
COPY --from=builder ${DIR}/packages ./packages

RUN yarn install --ignore-scripts --frozen-lockfile \
 && yarn cache clean


FROM ${BASE_IMAGE} AS build
WORKDIR ${DIR}

COPY --from=installer ${DIR}/ .
COPY --from=builder ${DIR}/out/full/ .

RUN yarn build --filter=web


FROM ${BASE_IMAGE} AS production
ENV NODE_ENV=production
WORKDIR ${DIR}

RUN apk add --no-cache dumb-init~=1

COPY --chown=node:node --from=installer ${DIR}/node_modules ./node_modules
COPY --chown=node:node --from=build ${DIR}/apps/web/.next ./.next
COPY --chown=node:node --from=build ${DIR}/apps/web/package.json ./package.json
COPY --chown=node:node --from=build ${DIR}/apps/web/public ./public
COPY --chown=node:node --from=build ${DIR}/apps/web/entrypoint.sh ./entrypoint.sh

ENV NODE_OPTIONS="--require ./node_modules/@instana/collector/src/immediate"

USER node
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["sh","-c","./entrypoint.sh"]
EXPOSE 3000

FROM production AS patched
USER root
RUN apk -U upgrade
USER node
