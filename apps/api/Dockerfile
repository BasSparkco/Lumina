# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS builder
WORKDIR /repo

RUN apt-get update && apt-get install -y --no-install-recommends openssl python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.12.4 --activate

# Full workspace install: api/worker/dashboard/player share the pnpm workspace lockfile, so all
# of their package.jsons need to be present for `pnpm install --frozen-lockfile` to resolve.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json turbo.json ./
COPY apps/api apps/api
COPY apps/worker/package.json apps/worker/package.json
COPY apps/dashboard/package.json apps/dashboard/package.json
COPY apps/player/package.json apps/player/package.json
COPY packages packages
RUN pnpm install --frozen-lockfile

# prisma.config.ts eagerly validates DATABASE_URL at config-load time (Prisma 7), even for
# `generate`, which never opens a connection — a placeholder is enough at build time; the real
# value is injected as a runtime env var by docker-compose for `migrate deploy`/the app itself.
RUN DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" pnpm --filter api exec prisma generate
# @lumina/db compiles the generated (Prisma-authored) client .ts sources to plain CommonJS —
# it must be built before api, since api only consumes @lumina/db's compiled dist output.
RUN pnpm --filter @lumina/db build
# api's prisma/theme-presets.ts and themes.service.ts consume @lumina/types' compiled output.
RUN pnpm --filter @lumina/types build
RUN pnpm --filter api build

# ── Runtime stage ─────────────────────────────────────────────────────────────
# Not a slim/pruned image: keeps the full workspace node_modules (as built) so the generated
# Prisma client (now at packages/db/generated/prisma, see prisma/schema.prisma's generator
# `output`) is guaranteed to match what was just typechecked and built — a fresh
# `pnpm deploy --prod` here re-resolves node_modules and drops workspace-linked packages like
# @lumina/db, breaking `new PrismaClient()` at runtime with a module-not-found error.
FROM node:24-bookworm-slim AS runner
WORKDIR /repo

RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /repo/node_modules node_modules
COPY --from=builder /repo/apps/api apps/api
COPY --from=builder /repo/packages packages

WORKDIR /repo/apps/api
EXPOSE 4000
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && node dist/src/main"]
