# ── Stage 1: build the React client ──────────────────────────────────────────
FROM node:22-bookworm-slim AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci --no-audit --no-fund
COPY client/ ./
RUN npm run build

# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=3001 \
    DATA_DIR=/app/data

# git: used by the Vlocity tool; postgresql-client: pg_dump/psql for backups
RUN apt-get update \
    && apt-get install -y --no-install-recommends git curl ca-certificates postgresql-client \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Salesforce CLI and Vlocity Build tool (required for export/deploy jobs)
ARG SF_CLI_VERSION=latest
ARG VLOCITY_CLI_VERSION=latest
RUN npm install -g --no-audit --no-fund "@salesforce/cli@${SF_CLI_VERSION}" "vlocity@${VLOCITY_CLI_VERSION}" \
    && npm cache clean --force

WORKDIR /app
COPY package*.json ./
COPY scripts/check-cli-tools.js ./scripts/
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY server ./server
COPY scripts ./scripts
COPY .sequelizerc ./
COPY --from=client-build /app/client/build ./client/build

# Writable runtime folders (mount volumes over data/, logs/ and the SF CLI auth dirs)
RUN mkdir -p data logs uploads jobs temp /home/node/.sf /home/node/.sfdx \
    && chown -R node:node /app /home/node
USER node

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -fsS http://localhost:3001/health || exit 1

CMD ["node", "--max-http-header-size=32768", "server/index.js"]
