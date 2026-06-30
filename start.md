# Running Lumina — Daily Dev Guide

## Prerequisites (one-time setup)

| Tool | Version | Check |
|---|---|---|
| Node.js | ≥ 20 | `node -v` |
| pnpm | ≥ 9 | `pnpm -v` |
| Docker + Compose | any recent | `docker compose version` |

```bash
# From the repo root — install all workspace deps
pnpm install
```

---

## Every day: Start the stack

### 1 — Start infrastructure

```bash
docker compose -f infra/docker/docker-compose.yml up -d
```

| Service  | URL |
|---|---|
| PostgreSQL | `localhost:5434` |
| Redis | `localhost:6381` |
| MinIO (S3) | `localhost:9010` |
| MinIO console | http://localhost:9011 (user: `lumina` / `luminasecret`) |

To stop infra at end of day:

```bash
docker compose -f infra/docker/docker-compose.yml down
```

---

### 2 — Run all apps together (recommended)

```bash
pnpm dev
```

Turborepo starts all four apps in parallel.

| App | URL |
|---|---|
| Dashboard | http://localhost:3000 |
| API | http://localhost:4000 |
| Player (PWA) | http://localhost:5000 |

---

### 2b — Run apps individually (if you only need one)

```bash
# API
pnpm --filter api dev

# Dashboard
pnpm --filter dashboard dev

# Worker (processes thumbnail jobs — runs headless)
pnpm --filter worker dev

# Player
pnpm --filter player dev
```

---

### 3 — First time / after schema changes: run migrations

```bash
pnpm db:migrate
```

To seed demo data (admin@demo.com / changeme):

```bash
pnpm db:seed
```

To browse the database visually:

```bash
pnpm db:studio   # opens http://localhost:5555
```

---

## Testing the full flow

1. Open **http://localhost:3000/en/register** → create your account
2. Open **http://localhost:5000** in a separate browser window → note the 6-character pairing code
3. In the dashboard → **Screens** → click **Pair screen** → enter the code
4. In the dashboard → **Assets** → upload a few images
5. In the dashboard → **Playlists** → create a playlist → add the images → set durations
6. In the dashboard → **Screens** → assign the playlist to your screen
7. Watch the player at **http://localhost:5000** start the slideshow automatically

---

## API documentation

Interactive Swagger UI: **http://localhost:4000/docs**

---

## Environment variables

All `.env` files are pre-filled for local dev. If you add a new variable:

```bash
# root .env (used by worker)
# apps/api/.env (used by NestJS)
# apps/dashboard/.env.local (used by Next.js)
# apps/player/.env (used by Vite)
```

---

## Common tasks

### Add a Prisma migration

```bash
cd apps/api
DATABASE_URL="postgresql://lumina:lumina@localhost:5434/lumina" \
  pnpm exec prisma migrate dev --name <describe-change>
```

### Reset the database (destructive!)

```bash
cd apps/api
DATABASE_URL="postgresql://lumina:lumina@localhost:5434/lumina" \
  pnpm exec prisma migrate reset
```

### Check container health

```bash
docker compose -f infra/docker/docker-compose.yml ps
```

### Clear MinIO data (destructive!)

```bash
docker compose -f infra/docker/docker-compose.yml down -v
```

---

## Ports at a glance

| Service | Port | Note |
|---|---|---|
| Dashboard | 3000 | Next.js |
| API | 4000 | NestJS |
| Player | 5000 | Vite PWA |
| Prisma Studio | 5555 | `pnpm db:studio` |
| PostgreSQL | 5434 | Offset from 5432 (other projects) |
| Redis | 6381 | Offset from 6379 |
| MinIO API | 9010 | S3-compatible |
| MinIO Console | 9011 | Web UI |
