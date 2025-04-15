# Using a consistent base for all stages
ARG BASE_IMAGE=icr.io/skills-network/node:20
# hadolint ignore=DL3006
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
# hadolint ignore=DL3006
FROM ${BASE_IMAGE} AS installer
ARG DIR=/usr/src/app
WORKDIR $DIR
COPY --from=builder $DIR/out/json/ .
COPY --from=builder $DIR/out/yarn.lock ./yarn.lock
COPY --from=builder $DIR/turbo.json ./turbo.json
COPY --from=builder $DIR/packages ./packages
COPY --from=builder $DIR/apps/api/prisma ./prisma
# Install build dependencies (including pkgconf) and rebuild native modules
RUN apk add --no-cache python3~=3 make~=4 g++~=14 pkgconf~=2 \
  && yarn install --frozen-lockfile \
  && yarn prisma generate \
  && npm rebuild cld --build-from-source

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
ENV NODE_ENV production
ARG DIR=/usr/src/app
WORKDIR $DIR
RUN apk add --no-cache dumb-init~=1 postgresql15-client~=15
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
