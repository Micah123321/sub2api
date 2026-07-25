# =============================================================================
# sub2api-agent-ledger — multi-stage image
# Build context: repository root (sub2api/)
# Compose: docker compose -f deploy/agent-ledger/docker-compose.yml build
# =============================================================================

ARG NODE_IMAGE=node:22-bookworm-slim

# -----------------------------------------------------------------------------
# Stage 1: install + build
# -----------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS builder

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare pnpm@11.6.0 --activate

WORKDIR /app

COPY sub2api-agent-ledger/package.json \
     sub2api-agent-ledger/pnpm-lock.yaml \
     sub2api-agent-ledger/pnpm-workspace.yaml \
     ./
RUN pnpm install --frozen-lockfile

COPY sub2api-agent-ledger/ ./
RUN pnpm build \
  && pnpm prune --prod

# -----------------------------------------------------------------------------
# Stage 2: runtime
# -----------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime

LABEL description="sub2api Agent Ledger plugin"
LABEL org.opencontainers.image.source="https://github.com/Micah123321/sub2api"

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates tini curl \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --gid 1000 ledger \
  && useradd --uid 1000 --gid ledger --shell /bin/bash --create-home ledger

WORKDIR /app

COPY --from=builder --chown=ledger:ledger /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder --chown=ledger:ledger /app/node_modules ./node_modules
COPY --from=builder --chown=ledger:ledger /app/dist ./dist
COPY --chown=ledger:ledger deploy/agent-ledger/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
  && mkdir -p /app/data \
  && chown -R ledger:ledger /app/data

ENV NODE_ENV=production \
    PORT=4173 \
    PLUGIN_DATA_DIR=/app/data \
    CORS_ORIGINS=http://localhost:4173,http://127.0.0.1:4173

USER ledger
EXPOSE 4173

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT:-4173}/api/health" || exit 1

ENTRYPOINT ["tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/server/main.js"]
