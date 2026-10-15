# Build context is the repo root: docker build -f apps/api/Dockerfile .
FROM node:24.22.0-alpine AS base
RUN npm install -g pnpm@12.11.2
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
# Add every workspace package the API imports.
COPY packages/shared/package.json packages/shared/
COPY packages/i18n/package.json packages/i18n/
RUN pnpm install --frozen-lockfile --filter "api..."

FROM deps AS dev
COPY apps/api apps/api
COPY packages packages
EXPOSE 4000
CMD ["pnpm", "--filter", "api", "dev"]

FROM deps AS build
COPY apps/api apps/api
COPY packages packages
RUN pnpm --filter "api..." run build \
  && pnpm deploy --filter api --prod /out \
  && test -f /out/dist/server.js \
  && test -f /out/dist/db/migrate.js \
  && test -f /out/dist/db/migrations/meta/_journal.json

FROM node:24.22.0-alpine AS prod
ENV NODE_ENV=production TZ=UTC
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /out ./
USER app
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:4000/health || exit 1
CMD ["node", "dist/server.js"]
