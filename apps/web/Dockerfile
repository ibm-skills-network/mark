FROM icr.io/skills-network/node:18 AS base

ARG DIR=/usr/src/app

FROM base AS build
ENV NODE_ENV build

WORKDIR $DIR
COPY package.json ../../yarn.lock ./
RUN yarn install --ignore-scripts --frozen-lockfile

# Copy the Next.js application files
COPY . .

# Build the Next.js app
RUN yarn build && yarn install --production

FROM base AS production
ENV NODE_ENV production

# Install dumb-init for a better signal forwarding
RUN apk add --no-cache dumb-init~=1

# Set working directory
WORKDIR $DIR

# Copy the built Next.js application and its dependencies
COPY --chown=node:node --from=build $DIR/.next ./.next
COPY --chown=node:node --from=build $DIR/public ./public
COPY --chown=node:node --from=build $DIR/node_modules ./node_modules
COPY --chown=node:node --from=build $DIR/package.json ./package.json

# Use dumb-init as the entry point
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
# Start the Next.js application
CMD ["yarn", "start"]
EXPOSE 3000

FROM production AS patched

USER root
RUN apk -U upgrade
USER node
