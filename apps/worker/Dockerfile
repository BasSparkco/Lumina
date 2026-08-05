# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS builder
WORKDIR /repo

RUN apt-get update && apt-get install -y --no-install-recommends openssl python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.12.4 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json turbo.json ./
COPY apps/worker apps/worker
COPY apps/api/package.json apps/api/package.json
COPY apps/api/prisma apps/api/prisma
COPY apps/dashboard/package.json apps/dashboard/package.json
COPY apps/player/package.json apps/player/package.json
COPY packages packages
RUN pnpm install --frozen-lockfile

RUN pnpm --filter worker exec prisma generate --schema=../api/prisma/schema.prisma
# @lumina/db compiles the generated (Prisma-authored) client .ts sources to plain CommonJS —
# it must be built before worker, since worker only consumes @lumina/db's compiled dist output.
RUN pnpm --filter @lumina/db build
RUN pnpm --filter worker build

# ── Runtime stage ─────────────────────────────────────────────────────────────
# Not a slim/pruned image — see apps/api/Dockerfile for why `pnpm deploy --prod` isn't used here
# (it drops the generated Prisma client engine).
FROM node:24-bookworm-slim AS runner
WORKDIR /repo

# ffmpeg/ffprobe (via the installer packages) and sharp both need these at runtime,
# same baseline as Dockerfile.dev. poppler-utils (pdftoppm) rasterizes PDF pages; libreoffice
# (headless, via its `soffice` binary) converts PPT/PPTX/DOC/DOCX to PDF first — both needed for
# the DOCUMENT asset pipeline in media.processor.ts. libreoffice is a large package; accepted
# trade-off for full OptiSigns document-format parity instead of PDF-only.
RUN apt-get update && apt-get install -y --no-install-recommends openssl procps poppler-utils libreoffice \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /repo/node_modules node_modules
COPY --from=builder /repo/apps/worker apps/worker
COPY --from=builder /repo/apps/api/prisma apps/api/prisma
COPY --from=builder /repo/packages packages

WORKDIR /repo/apps/worker
CMD ["node", "dist/main"]
