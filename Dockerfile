# jobgraph API with the worker embedded (scheduler, channels, Playwright apply drivers) in one process.
# Playwright tag must match node_modules/playwright/package.json (1.64.1).
FROM mcr.microsoft.com/playwright:v1.64.1-noble

ENV DEBIAN_FRONTEND=noninteractive
# The Playwright image ships a Node LTS; make sure it is Node 22.
RUN if [ "$(node -p 'process.versions.node.split(".")[0]')" != "22" ]; then \
      apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
      && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
      && apt-get install -y --no-install-recommends nodejs \
      && rm -rf /var/lib/apt/lists/*; \
    fi \
    && node -v

WORKDIR /app

# Browsers come from the base image (/ms-playwright); the Electron companion is not needed on the server.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

# Dependency layer first so code changes do not reinstall.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY apps/companion/package.json apps/companion/
COPY packages/core/package.json packages/core/
COPY packages/drivers/package.json packages/drivers/
COPY packages/channels/package.json packages/channels/
RUN npm ci

COPY . .

# Runtime config. Secrets (DATABASE_URL, CREDENTIALS_KEY, ...) are injected by the platform, never baked in.
# Resume PDFs and screenshots are written under ARTIFACTS_DIR; mount a volume at /data.
ENV NODE_ENV=production \
    EMBED_WORKER=1 \
    API_PORT=4000 \
    ARTIFACTS_DIR=/data/artifacts

RUN mkdir -p /data/artifacts && chown -R pwuser:pwuser /data /app && chmod 755 /app/scripts/docker/entrypoint.sh
VOLUME ["/data"]
# No USER line: the entrypoint starts as root only to hand a freshly mounted /data volume to pwuser, then runs the app
# as pwuser (scripts/docker/entrypoint.sh).
ENTRYPOINT ["/app/scripts/docker/entrypoint.sh"]

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node_modules/.bin/tsx", "apps/api/src/index.ts"]
