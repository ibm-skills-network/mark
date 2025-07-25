# Using a consistent base for all stages
ARG BASE_IMAGE=node:22-alpine
FROM ${BASE_IMAGE} AS builder

ARG DIR=/usr/src/app

# Pruning using turbo for the Next.js app
WORKDIR $DIR
COPY . .
RUN yarn global add turbo@^2.0.3
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
