# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# base — toolchain needed to compile @discordjs/opus
# ---------------------------------------------------------------------------
FROM node:22-bookworm AS base
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
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/app/data \
    FFMPEG_PATH=ffmpeg \
    FFPROBE_PATH=ffprobe

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./web/dist
COPY server/package.json ./server/package.json
COPY package.json ./package.json

RUN mkdir -p /app/data/media /app/data/pcm && chown -R node:node /app/data
USER node
VOLUME ["/app/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server/dist/index.js"]
