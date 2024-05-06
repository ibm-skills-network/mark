# Using a consistent base for all stages
FROM icr.io/skills-network/node:20 AS base

ARG SN_GITHUB_NPM_TOKEN
ARG SN_GITHUB_NPM_REGISTRY=https://npm.pkg.github.com
ARG DIR=/usr/src/app
ENV DIR=${DIR}

# Pruning using turbo
FROM base AS builder
WORKDIR $DIR
COPY . .
RUN yarn global add turbo
RUN echo "@ibm-skills-network:registry=$SN_GITHUB_NPM_REGISTRY" >> .npmrc && echo "//npm.pkg.github.com/:_authToken=$SN_GITHUB_NPM_TOKEN" >> .npmrc
RUN turbo prune --scope=api-gateway --docker && rm -f .npmrc

# Installing the isolated workspace
FROM base AS installer
WORKDIR $DIR
COPY --from=builder $DIR/out/json/ .
COPY --from=builder $DIR/out/yarn.lock ./yarn.lock
COPY --from=builder $DIR/turbo.json ./turbo.json
COPY --from=builder $DIR/packages ./packages
RUN yarn install --ignore-scripts --frozen-lockfile

# Running build using turbo
FROM base AS sourcer
WORKDIR $DIR
COPY --from=installer $DIR/ .
COPY --from=builder $DIR/out/full/ .
COPY --from=builder /usr/local/share/.config/yarn/global /usr/local/share/.config/yarn/global
RUN /usr/local/share/.config/yarn/global/node_modules/.bin/turbo run build --scope=api-gateway --include-dependencies && yarn install --production --ignore-scripts --frozen-lockfile

# Production stage
FROM base AS production
ENV NODE_ENV production
WORKDIR $DIR
RUN apk add --no-cache dumb-init=1.2.5-r3
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
