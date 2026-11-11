# syntax=docker/dockerfile:1
# Builds two images from one file:
#   --target web      the Next.js app, as a small self-contained server
#   --target migrate  a one-shot job that applies database migrations
# Works on x86 and ARM (Oracle's free Ampere machines are ARM).

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN npm install -g pnpm@12.11.2
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/calc/package.json packages/calc/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @fin/web build

FROM deps AS migrate
COPY packages/db packages/db
CMD ["pnpm", "--filter", "@fin/db", "exec", "tsx", "src/migrate.ts"]

FROM node:22-slim AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
