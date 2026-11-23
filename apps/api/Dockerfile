FROM node:22-slim AS builder
WORKDIR /app

COPY package.json package-lock.json* turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/embeddings/package.json packages/embeddings/
COPY packages/llm/package.json packages/llm/
COPY packages/ingestion/package.json packages/ingestion/
COPY packages/tailoring/package.json packages/tailoring/
COPY apps/api/package.json apps/api/

RUN npm ci --workspace=@jobpilot/shared --workspace=@jobpilot/embeddings --workspace=@jobpilot/llm --workspace=@jobpilot/ingestion --workspace=@jobpilot/tailoring --workspace=@jobpilot/api

COPY packages/shared packages/shared
COPY packages/embeddings packages/embeddings
COPY packages/llm packages/llm
COPY packages/ingestion packages/ingestion
COPY packages/tailoring packages/tailoring
COPY apps/api apps/api

RUN npm run build --workspace=@jobpilot/shared \
  && npm run build --workspace=@jobpilot/embeddings \
  && npm run build --workspace=@jobpilot/llm \
  && npm run build --workspace=@jobpilot/ingestion \
  && npm run build --workspace=@jobpilot/tailoring \
  && npm run build --workspace=@jobpilot/api

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# Install static Typst binary for ATS PDF rendering (falls back gracefully if skipped)
RUN apt-get update && apt-get install -y --no-install-recommends curl xz-utils ca-certificates \
  && ARCH=$(uname -m) \
  && TARGET=$([ "$ARCH" = "aarch64" ] && echo "aarch64-unknown-linux-musl" || echo "x86_64-unknown-linux-musl") \
  && curl -fsSL "https://github.com/typst/typst/releases/latest/download/typst-${TARGET}.tar.xz" -o /tmp/typst.tar.xz \
  && tar -xf /tmp/typst.tar.xz -C /tmp \
  && mv /tmp/typst-${TARGET}/typst /usr/local/bin/typst \
  && chmod +x /usr/local/bin/typst \
  && rm -rf /tmp/typst* /var/lib/apt/lists/* \
  && apt-get purge -y --auto-remove curl xz-utils

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/api ./apps/api

EXPOSE 4000
CMD ["node", "apps/api/dist/server.js"]
