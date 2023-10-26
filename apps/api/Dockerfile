# Using a consistent base for all stages
FROM icr.io/skills-network/node:18 AS base

ARG SN_GITHUB_NPM_TOKEN
ARG SN_GITHUB_NPM_REGISTRY=https://npm.pkg.github.com
ARG DIR=/usr/src/app
ENV DIR=${DIR}

# Pruning using turbo
FROM base AS builder
WORKDIR $DIR
RUN yarn global add turbo
COPY . .
RUN echo "@ibm-skills-network:registry=$SN_GITHUB_NPM_REGISTRY" >> .npmrc && echo "//npm.pkg.github.com/:_authToken=$SN_GITHUB_NPM_TOKEN" >> .npmrc
RUN turbo prune --scope=api --docker && rm -f .npmrc

# Installing the isolated workspace
FROM base AS installer
WORKDIR $DIR
COPY --from=builder $DIR/out/json/ .
COPY --from=builder $DIR/out/yarn.lock ./yarn.lock
COPY --from=builder $DIR/turbo.json ./turbo.json
COPY --from=builder $DIR/packages ./packages
COPY --from=builder $DIR/apps/api/prisma ./prisma
RUN yarn install --ignore-scripts --frozen-lockfile && yarn prisma generate

# Running build using turbo
FROM base AS sourcer
WORKDIR $DIR
COPY --from=installer $DIR/ .
COPY --from=builder $DIR/out/full/ .
RUN yarn turbo run build --scope=api --include-dependencies

# Production stage
FROM base AS production
ENV NODE_ENV production
WORKDIR $DIR
RUN apk add --no-cache dumb-init~=1
COPY --chown=node:node --from=sourcer $DIR/apps/api/dist ./dist
COPY --chown=node:node --from=sourcer $DIR/node_modules $DIR/node_modules
COPY --chown=node:node --from=sourcer $DIR/prisma ./prisma
COPY --chown=node:node --from=sourcer $DIR/apps/api/migrate.sh ./migrate.sh
COPY --chown=node:node --from=sourcer $DIR/apps/api/ensureDb.js ./ensureDb.js
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "/usr/src/app/dist/main.js"]
EXPOSE 3000

# Patched stage with updates
FROM production AS patched
USER root
RUN apk -U upgrade
USER node
