FROM icr.io/skills-network/node:18 AS builder
# RUN apk update
# # Set working directory
# WORKDIR /app
# RUN yarn global add turbo
# COPY . .
# # Only Take packages that are needed to compile this app
# RUN turbo prune --scope=web --docker

# # Add lockfile and package.json's of isolated subworkspace
# FROM icr.io/skills-network/node:18 AS installer
# RUN apk update
# RUN apk add --no-cache libc6-compat
# WORKDIR /app
# COPY --from=builder /app/out/json/ .
# COPY --from=builder /app/out/yarn.lock ./yarn.lock
# COPY --from=builder /app/turbo.json ./turbo.json
# RUN yarn install --frozen-lockfile


# FROM icr.io/skills-network/node:18 AS sourcer
# RUN apk update
# WORKDIR /app
# COPY --from=installer /app/ .
# COPY --from=builder /app/out/full/ .
# COPY .gitignore .gitignore
# RUN yarn turbo run build --scope=web --include-dependencies --no-deps

# FROM icr.io/skills-network/node:18 as runner
# WORKDIR /app
# COPY --from=sourcer /app/ .
# WORKDIR /app/apps/web/
# CMD [ "npm", "start" ]