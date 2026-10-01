# syntax = docker/dockerfile:1

# The image Fly builds and runs, and CI runs the spec against: one Node
# process serving HTTP and the WebSocket on 0.0.0.0:$PORT, with its SQLite
# database on the /data volume (docs/adr/001). The server is TypeScript run
# directly by Node's type stripping, so only the client is built.

ARG NODE_VERSION=24
FROM node:${NODE_VERSION}-slim AS base

WORKDIR /app
ENV NODE_ENV=production

ARG PNPM_VERSION=11.9.0
RUN npm install -g pnpm@$PNPM_VERSION

# --- build stage: install everything, bundle the client, prune to prod deps --
FROM base AS build

# toolchain for better-sqlite3, in case no prebuilt binary matches the image
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential pkg-config python-is-python3

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod=false

COPY . .
RUN pnpm run build
RUN pnpm prune --prod

# --- runtime stage: the server source, the client bundle, prod deps ---------
FROM base

COPY --from=build /app/package.json /app/package.json
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/src /app/src
COPY --from=build /app/dist /app/dist
# the committed migrations, applied at boot
COPY --from=build /app/drizzle /app/drizzle
# /readme/ renders README.md per request, and serves the images it links
COPY --from=build /app/README.md /app/README.md
COPY --from=build /app/docs /app/docs

ENV PORT=8080
ENV DATABASE_PATH=/data/raid.db
EXPOSE 8080
CMD ["node", "src/server/main.ts"]
