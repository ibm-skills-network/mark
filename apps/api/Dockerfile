FROM icr.io/skills-network/node:18 AS base

ARG SN_GITHUB_NPM_TOKEN
ARG SN_GITHUB_NPM_REGISTRY=https://npm.pkg.github.com
ARG DIR=/usr/src/app

FROM base AS build
ENV NODE_ENV build

WORKDIR $DIR
COPY package.json yarn.lock tsconfig*.json ./
# pragma: allowlist nextline secret
RUN echo "@ibm-skills-network:registry=$SN_GITHUB_NPM_REGISTRY" >> .npmrc && echo "//npm.pkg.github.com/:_authToken=$SN_GITHUB_NPM_TOKEN" >> .npmrc \
  && yarn install --ignore-scripts --frozen-lockfile \
  && rm -f .npmrc

COPY ./src ./src

RUN yarn build \
  && yarn install --ignore-scripts --production

FROM base AS production
ENV NODE_ENV production

RUN apk add --no-cache dumb-init~=1

WORKDIR $DIR

COPY --chown=node:node --from=build $DIR/dist ./dist
COPY --chown=node:node --from=build $DIR/node_modules $DIR/node_modules

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "dist/main.js"]
EXPOSE 3000

FROM production AS patched

USER root
RUN apk -U upgrade
USER node
