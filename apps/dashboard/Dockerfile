# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS builder
WORKDIR /repo

RUN corepack enable && corepack prepare pnpm@10.12.4 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json turbo.json ./
COPY apps/dashboard apps/dashboard
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/player/package.json apps/player/package.json
COPY packages packages
RUN pnpm install --frozen-lockfile

# NEXT_PUBLIC_* vars are baked into the client bundle at build time.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_WS_URL
ARG NEXT_PUBLIC_PLAYER_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_PLAYER_URL=$NEXT_PUBLIC_PLAYER_URL

RUN pnpm --filter dashboard build

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# Next.js standalone output (server.js + a pruned node_modules). With
# outputFileTracingRoot set to the repo root, paths inside standalone are relative to the repo
# root, so server.js lives at apps/dashboard/server.js.
COPY --from=builder /repo/apps/dashboard/.next/standalone ./
COPY --from=builder /repo/apps/dashboard/.next/static     ./apps/dashboard/.next/static
COPY --from=builder /repo/apps/dashboard/public           ./apps/dashboard/public

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
CMD ["node", "apps/dashboard/server.js"]
