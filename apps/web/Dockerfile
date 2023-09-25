# Using a consistent base for all stages
FROM icr.io/skills-network/node:18 AS base

ARG SN_GITHUB_NPM_TOKEN
ARG SN_GITHUB_NPM_REGISTRY=https://npm.pkg.github.com
ARG DIR=/usr/src/app
ENV DIR=${DIR}

# Pruning using turbo for the Next.js app
FROM base AS builder
WORKDIR $DIR
RUN yarn global add turbo
COPY . .
# pragma: allowlist secret 
RUN echo "@ibm-skills-network:registry=$SN_GITHUB_NPM_REGISTRY" >> .npmrc && echo "//npm.pkg.github.com/:_authToken=$SN_GITHUB_NPM_TOKEN" >> .npmrc
RUN turbo prune --scope=web --docker && rm -f .npmrc

# Installing the isolated workspace for the Next.js app
FROM base AS installer
WORKDIR $DIR
COPY --from=builder $DIR/ .
RUN yarn install --ignore-scripts --frozen-lockfile && yarn cache clean

# Running build using turbo for the Next.js app
FROM installer AS sourcer
WORKDIR $DIR
RUN yarn turbo run build --scope=web --include-dependencies

# Production stage
FROM base AS production
ENV NODE_ENV production
WORKDIR $DIR
RUN apk add --no-cache dumb-init~=1
COPY --chown=node:node --from=sourcer $DIR/apps/web/.next ./.next
COPY --chown=node:node --from=sourcer $DIR/package.json $DIR/package.json
COPY --chown=node:node --from=sourcer $DIR/node_modules $DIR/node_modules
COPY --chown=node:node --from=sourcer $DIR/apps/web/config.template.js ./config.template.js
COPY --chown=node:node --from=sourcer $DIR/apps/web/entrypoint.sh ./entrypoint.sh
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["./entrypoint.sh"]
EXPOSE 3000

# Patched stage with updates
FROM production AS patched
USER root
RUN apk -U upgrade
USER node
