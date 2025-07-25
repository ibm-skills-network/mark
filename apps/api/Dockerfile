# local-test/api.Dockerfile
# Using a consistent base for all stages
ARG BASE_IMAGE=node:22-alpine
FROM node:22-alpine AS builder

ARG DIR=/usr/src/app

# Pruning using turbo
WORKDIR $DIR
COPY . .
RUN yarn global add turbo@^2.0.3
RUN turbo prune api --docker && rm -f .npmrc

# Installing the isolated workspace
FROM node:22-alpine AS installer
ARG DIR=/usr/src/app
WORKDIR $DIR
COPY --from=builder $DIR/out/json/ .
COPY --from=builder $DIR/out/yarn.lock ./yarn.lock
COPY --from=builder $DIR/turbo.json ./turbo.json
COPY --from=builder $DIR/packages ./packages
RUN yarn install --ignore-scripts --frozen-lockfile

# Running build using turbo
FROM node:22-alpine AS sourcer
ARG DIR=/usr/src/app
WORKDIR $DIR
COPY --from=installer $DIR/ .
COPY --from=builder $DIR/out/full/ .
COPY --from=builder /usr/local/share/.config/yarn/global /usr/local/share/.config/yarn/global
WORKDIR $DIR/apps/api
RUN npx prisma generate
WORKDIR $DIR
RUN yarn build --filter=api && yarn install --production --ignore-scripts --frozen-lockfile

# Production stage
FROM node:22-alpine AS production
ARG DIR=/usr/src/app
ENV NODE_ENV production
WORKDIR $DIR
RUN apk add --no-cache dumb-init=1.2.5-r3
COPY --chown=node:node --from=sourcer $DIR/apps/api/dist ./dist
COPY --chown=node:node --from=sourcer $DIR/node_modules $DIR/node_modules
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "dist/main.js"]
EXPOSE 3000

# Patched stage with updates
FROM production AS patched
USER root
RUN apk -U upgrade
USER node