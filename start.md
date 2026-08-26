# Running Lumina — Daily Dev Guide

## ⚠️ This server also runs Lumina's own production stack

This host runs `docker-compose.prod.yml` behind Traefik in parallel with dev — containers named
`lumina-postgres-1`, `lumina-redis-1`, `lumina-minio-1`, `lumina-api-1`, `lumina-worker-1`,
`lumina-dashboard-1`, `lumina-player-1` (hyphenated, no host-published ports). **Never stop,
restart, or `docker rm` those.** The containers you actually want for dev are the
underscore-named ones below (`lumina_postgres`, `lumina_redis`, `lumina_minio`) — check
`docker ps` and confirm the name before touching any container or killing any PID on this box.

---

## Quick start on this server

Infra and the dev apps are very likely **already running** (they're long-lived on this box, not
started fresh each session). Check before you launch anything — starting a second `next dev` on
an occupied port fails outright, and a second `nest start --watch` becomes an orphaned duplicate
that just wastes memory.

```bash
# 1. Is infra up?
docker ps --filter "name=lumina_" --format "table {{.Names}}\t{{.Ports}}\t{{.Status}}"

# 2. Is the dashboard already serving?
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000
```

If step 2 prints `200`/`307`, the dashboard is already up — open **http://localhost:3000** and
you're done.

### If infra is down

```bash
docker start lumina_postgres lumina_redis lumina_minio
```

These containers were created outside `infra/docker/docker-compose.yml`'s lifecycle and are
bound to different host ports than that file currently declares (see [Ports](#ports-at-a-glance)
below) — `docker start` on the existing containers, not `docker compose up`, is the safe way to
bring them back. Only fall back to `docker compose -f infra/docker/docker-compose.yml up -d` if
the containers are gone entirely (`docker ps -a` doesn't show them), and know that will create
them on the file's ports (5434/6381), not the 5435/6382 the apps' `.env` files currently point at
— update those `.env` files to match if you go that route.

### If the dashboard isn't running

```bash
cd /opt/sites/lumina/apps/dashboard
pnpm dev
```

Reads `.env.local` (already points at `http://localhost:4000/v1`). Runs in the foreground — use
`tmux`/`screen`, or background it yourself, if you want it to survive your shell exiting.

### If the API isn't running

```bash
cd /opt/sites/lumina/apps/api
pnpm dev   # nest start --watch, reads apps/api/.env
```

`GET http://localhost:4000/v1` should respond once it's up; Swagger is at
http://localhost:4000/docs.

### If the worker isn't running

```bash
cd /opt/sites/lumina/apps/worker
pnpm dev
```

Headless — processes thumbnail/media jobs off Redis. No port to check; watch its output for
"waiting for jobs" or similar instead.

---

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

## Starting fresh (new clone / new machine)

The steps above are for *this* server, where infra containers and `.env` files already agree on
non-default ports. On a clean machine, `infra/docker/docker-compose.yml`'s own ports (5434
Postgres / 6381 Redis / 9010-9011 MinIO) and the checked-in `.env.example` files match each
other, so the generic flow works as-is:

```bash
docker compose -f infra/docker/docker-compose.yml up -d
pnpm dev              # turbo — starts api/worker/dashboard/player together
pnpm db:migrate
pnpm db:seed          # demo login: admin@demo.com / changeme
```

| App | URL |
|---|---|
| Dashboard | http://localhost:3000 |
| API | http://localhost:4000 |
| Player (PWA) | http://localhost:5000 |

To run apps individually instead of all at once: `pnpm --filter <api\|dashboard\|worker\|player> dev`.

There's also a fully-dockerized dev flow (`pnpm docker:dev`, uses `docker-compose.dev.yml` +
the infra file together) if you'd rather not run Node on the host at all — not what's in use on
*this* server, but available.

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

```bash
# root .env (used by worker)
# apps/api/.env (used by NestJS)
# apps/dashboard/.env.local (used by Next.js)
# apps/player/.env (used by Vite)
```

On this server, `apps/api/.env` / `apps/worker/.env` point at `localhost:5435` (Postgres) and
`localhost:6382` (Redis) — the actual ports the running `lumina_postgres`/`lumina_redis`
containers publish. If you regenerate these `.env` files from `.env.example` on this box, put
those two ports back or the API/worker won't be able to connect.

---

## Common tasks

### Add a Prisma migration

```bash
cd apps/api
DATABASE_URL="postgresql://lumina:lumina@localhost:5435/lumina" \
  pnpm exec prisma migrate dev --name <describe-change>
```

### Reset the database (destructive!)

```bash
cd apps/api
DATABASE_URL="postgresql://lumina:lumina@localhost:5435/lumina" \
  pnpm exec prisma migrate reset
```

### Check container health

```bash
docker ps --filter "name=lumina_" --format "table {{.Names}}\t{{.Ports}}\t{{.Status}}"
```

### Clear MinIO data (destructive!)

Don't `docker compose down -v` here — it targets `infra/docker/docker-compose.yml`'s own
(currently unused, mismatched-port) container set, not the ones actually running. To wipe local
dev media on this server: `docker stop lumina_minio && docker rm lumina_minio` then recreate it
from `infra/docker/docker-compose.yml` (adjusting the port mapping to 9010/9011 first) or however
it was originally created.

---

## Ports at a glance

### This server (actual, running containers/processes)

| Service | Port | Note |
|---|---|---|
| Dashboard | 3000 | `next dev`, host process |
| API | 4000 | NestJS |
| Prisma Studio | 5555 | `pnpm db:studio` |
| PostgreSQL | **5435** | `lumina_postgres` container |
| Redis | **6382** | `lumina_redis` container |
| MinIO API | 9010 | `lumina_minio` container |
| MinIO Console | 9011 | Web UI |

### `infra/docker/docker-compose.yml`'s own declared ports (fresh-clone default, not what's live here)

| Service | Port |
|---|---|
| PostgreSQL | 5434 |
| Redis | 6381 |
| MinIO API | 9010 |
| MinIO Console | 9011 |
| Player | 5000 |
