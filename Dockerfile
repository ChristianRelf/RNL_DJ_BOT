# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# base — toolchain needed to compile @discordjs/opus
# ---------------------------------------------------------------------------
FROM node:24-bookworm AS base
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV npm_config_fund=false npm_config_audit=false

# ---------------------------------------------------------------------------
# deps — full dependency tree (dev included) for building
# ---------------------------------------------------------------------------
FROM base AS deps
COPY package.json package-lock.json* ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --workspaces --include-workspace-root || npm install --workspaces --include-workspace-root

# ---------------------------------------------------------------------------
# build — compile the React control surface and the TypeScript server
# ---------------------------------------------------------------------------
FROM deps AS build
COPY tsconfig.base.json ./
COPY server server
COPY web web
RUN npm run build -w web && npm run build -w server

# ---------------------------------------------------------------------------
# prod-deps — runtime dependency tree only
# ---------------------------------------------------------------------------
FROM base AS prod-deps
COPY package.json package-lock.json* ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev --workspaces --include-workspace-root \
    || npm install --omit=dev --workspaces --include-workspace-root

# ---------------------------------------------------------------------------
# runtime
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update \
# aubio is referenced by config.ts and reached by a live code path, and has
# never been in this image - so beat detection has been silently doing nothing
# in production. It is optional by design (a missing one costs a feature, never
# the mix), which is exactly why its absence went unnoticed.
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates tini aubio-tools \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=7403 \
    DATA_DIR=/app/data \
    FFMPEG_PATH=ffmpeg \
    FFPROBE_PATH=ffprobe

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./web/dist
COPY server/package.json ./server/package.json
COPY package.json ./package.json

RUN mkdir -p /app/data/media /app/data/pcm /app/data/tmp && chown -R node:node /app/data
USER node
VOLUME ["/app/data"]
EXPOSE 7403

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||7403)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server/dist/index.js"]
