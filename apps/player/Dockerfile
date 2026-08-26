# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS builder
WORKDIR /repo

RUN corepack enable && corepack prepare pnpm@10.12.4 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json turbo.json ./
COPY apps/player apps/player
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/dashboard/package.json apps/dashboard/package.json
COPY packages packages
RUN pnpm install --frozen-lockfile

# VITE_* vars are baked into the client bundle at build time.
ARG VITE_API_URL
ARG VITE_WS_URL
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_WS_URL=$VITE_WS_URL

# player consumes @lumina/types' compiled dist output, so it must be built first.
RUN pnpm --filter @lumina/types build
# designer.md Phase 11 — DesignRenderer.tsx consumes @lumina/design-schema's compiled output
# (ANIMATION_MOTION/resolveEasing/ResolvedDesignPayload etc.) the same package.json-resolution
# way as @lumina/types above — must come after it, since design-schema itself depends on types.
RUN pnpm --filter @lumina/design-schema build
RUN pnpm --filter player build

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM nginx:alpine AS runner
COPY apps/player/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /repo/apps/player/dist /usr/share/nginx/html
EXPOSE 80
