# Lumina Signage

> Cloud digital signage platform — turn any screen into a managed, remotely-controlled display.
> _(Working name — replace `Lumina` throughout with your final brand.)_

Lumina lets clients display anything on a screen from the cloud: timed image slideshows, long- or
short-form video, pre-built industry themes (e.g. restaurant menus with live prices), prayer
times and the call to prayer, background audio, and live data pulled from external APIs (flight
schedules, weather, currency exchange) — all managed remotely and updated in real time.

---

## Table of contents

1. [What it does](#what-it-does)
2. [Why this exists](#why-this-exists)
3. [Architecture](#architecture)
4. [Tech stack](#tech-stack)
5. [Monorepo layout](#monorepo-layout)
6. [Core concepts (glossary)](#core-concepts-glossary)
7. [Getting started](#getting-started)
8. [Environment variables](#environment-variables)
9. [External integrations](#external-integrations)
10. [Project status & roadmap](#project-status--roadmap)
11. [Contributing](#contributing)
12. [License](#license)

---

## What it does

**Content**
- Image slideshows with a configurable timer per image
- Video playback (short and long form), with normalization/transcoding on upload
- Background audio layered under images/slides
- Multi-zone layouts (e.g. main video + side menu + bottom ticker)
- Pre-made, editable themes per industry (restaurant/café menu with editable prices, retail
  promos, hotel lobby, clinic waiting room, etc.)
- Dynamic data fields — a price/number/label that auto-updates from a feed without re-editing
  the design

**Scheduling & control**
- Playlists with ordering and per-item duration
- Dayparting and rule-based scheduling (time of day, day of week, date ranges)
- Screen groups and tags — publish to one screen, a location, or the whole fleet at once
- Instant, real-time publishing to players
- Emergency override — take over all (or selected) screens with an alert message

**Faith / regional**
- Accurate prayer times computed on-device from coordinates (offline-capable)
- Call to prayer (athan) audio at the correct times
- First-class RTL support (Arabic, Hebrew) and full localization

**Live data (API-driven)**
- Flight schedules (airport / FIDS feeds, AeroAPI, AviationStack)
- Weather
- Currency exchange rates
- News / RSS tickers

**Operations**
- Multi-tenant: organizations, teams, role-based access
- Remote device pairing via short code
- Player health monitoring (online/offline, last seen, current content)
- Offline resilience — players cache content and keep playing without internet
- Proof-of-play reporting (what played, when, where)

---

## Why this exists

The cloud-signage market (OptiSigns, Navori, Yodeck, ScreenCloud, etc.) is mature but
generic. Lumina's differentiators:

- **Faith & regional focus** — built-in, accurate prayer times + athan + RTL, which the
  mainstream players treat as an afterthought. This targets mosques, MENA/Gulf restaurants and
  retail, and Middle-East airports/transit.
- **Themes that just work** — non-technical owners (a café) pick a theme, edit prices, and
  publish, without touching a design tool.
- **Reliability first** — the player keeps running offline; the network is treated as
  unreliable by design.

---

## Architecture

```
                         ┌──────────────────────────────┐
                         │        Web Dashboard          │
                         │       (Next.js, RTL)          │
                         │  clients · admins · resellers │
                         └───────────────┬───────────────┘
                                         │ HTTPS / REST + WS
                                         ▼
┌─────────────────┐        ┌──────────────────────────────┐        ┌────────────────────┐
│  External APIs  │◀──────▶│           API / Core          │◀──────▶│     PostgreSQL      │
│ flights·weather │ poll   │            (NestJS)           │  ORM   │ tenants·screens·    │
│ currency·RSS    │        │  REST · WebSocket gateway     │        │ playlists·schedules │
└─────────────────┘        └───────┬───────────────┬───────┘        └────────────────────┘
                                   │               │
                          jobs ▲   │               │ pub/sub · cache
                               │   ▼               ▼
                    ┌──────────────────┐    ┌──────────────┐
                    │  Worker (BullMQ) │    │    Redis     │
                    │ FFmpeg transcode │    └──────────────┘
                    │ thumbnails       │
                    │ feed polling     │           ┌──────────────────────────┐
                    │ proof-of-play    │──────────▶│   Object storage + CDN   │
                    └──────────────────┘   media   │   (S3 / R2 / MinIO)      │
                                                   └────────────┬─────────────┘
                                                                │ pull media (cached)
                       real-time commands / heartbeat           ▼
                    ┌───────────────────────────────────────────────────────────┐
                    │                       Player apps                          │
                    │   PWA web player (kiosk)  ·  Android  ·  smart-display app  │
                    │   offline cache · local scheduler · prayer-time engine     │
                    └───────────────────────────────────────────────────────────┘
```

**Key principle:** Postgres stores *metadata only*. All media lives in object storage and is
served through a CDN. Players **pull** media (and cache it locally) and **receive push** commands
(publish, override, reboot) over a persistent connection.

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Dashboard | **Next.js** (App Router, TypeScript) | SSR/SEO for marketing, fast app shell, RTL support |
| API / core | **NestJS** (TypeScript) | Modular DI architecture scales with domain complexity |
| Database | **PostgreSQL** | Relational data: tenants, screens, playlists, schedules |
| ORM | **Prisma** _(or TypeORM)_ | Type-safe queries, migrations |
| Cache / queue / pub-sub | **Redis** + **BullMQ** | Sessions, job queue, WebSocket fan-out across instances |
| Media storage | **S3-compatible** (Cloudflare R2 / AWS S3 / MinIO) | Cheap, scalable blob storage — keep media out of Postgres |
| Delivery | **CDN** (Cloudflare / CloudFront / Bunny) | Serve large video to many screens cheaply |
| Media processing | **FFmpeg** in worker | Transcode/normalize uploads, generate thumbnails |
| Real-time | **WebSockets** (NestJS Gateway) → **MQTT** at scale | Push to player fleet, receive heartbeats |
| Player | **PWA** (Service Worker + IndexedDB) → Android wrapper | Offline-first playback on cheap hardware |
| Prayer times | **adhan** library | Computed on-device, works offline |
| Auth | NestJS Passport + JWT _(or Keycloak / Clerk / Auth0)_ | Multi-tenant, role-based |
| Monorepo | **Turborepo** (or Nx) + **pnpm** | Share `types` package across dashboard/api/player |
| Containerization | **Docker** + Docker Compose (dev) | Reproducible local + prod parity |
| Observability | Sentry + structured logging (Pino) + Prometheus/Grafana | Errors, metrics, fleet health |

> The TypeScript-everywhere choice (Next + Nest + shared types) is the main reason this stack is
> a good fit — a screen's data shape is defined once and consumed by dashboard, API, and player.

---

## Monorepo layout

```
lumina/
├── apps/
│   ├── dashboard/        # Next.js — client & admin web app
│   ├── api/              # NestJS — REST + WebSocket gateway
│   ├── worker/           # NestJS/BullMQ — transcoding, feeds, proof-of-play
│   └── player/           # PWA web player (kiosk / WebView target)
├── packages/
│   ├── types/            # Shared TS types & API contracts (zod schemas)
│   ├── ui/               # Shared React components (RTL-aware)
│   ├── prayer/           # Prayer-time engine wrapper (adhan)
│   └── config/           # Shared eslint/tsconfig/tailwind presets
├── infra/
│   ├── docker/           # Dockerfiles, docker-compose.yml
│   └── migrations/       # DB migrations
├── ROADMAP.md
└── README.md
```

---

## Core concepts (glossary)

| Term | Meaning |
|---|---|
| **Organization (tenant)** | A client account; all data is scoped to it |
| **Screen / Device** | A physical display running the player; paired via a code |
| **Player** | The app running on the device that renders content |
| **Asset** | A single piece of media (image, video, audio) |
| **Layout** | A screen divided into zones |
| **Zone** | A region of a layout that holds a playlist |
| **Playlist** | An ordered list of items, each with a duration |
| **Theme / Template** | A pre-built, editable design (e.g. café menu) |
| **Schedule** | Rules deciding what plays where and when (dayparting) |
| **Publish** | Pushing a schedule/playlist live to one or more screens |
| **Heartbeat** | Periodic health signal from a player |
| **Proof-of-play** | A log entry recording that an asset played at a time on a screen |

---

## Getting started

> Prerequisites: Node.js 20+, pnpm 9+, Docker, FFmpeg (provided via the worker container).

```bash
# 1. Clone & install
git clone <repo-url> lumina && cd lumina
pnpm install

# 2. Start infra (Postgres, Redis, MinIO)
docker compose -f infra/docker/docker-compose.yml up -d

# 3. Configure env (see below)
cp .env.example .env

# 4. Run migrations + seed
pnpm db:migrate
pnpm db:seed

# 5. Run everything in dev
pnpm dev          # turbo runs dashboard + api + worker + player
```

| App | URL (dev) |
|---|---|
| Dashboard | http://localhost:3000 |
| API | http://localhost:4000 |
| Player | http://localhost:5000 |
| MinIO console | http://localhost:9001 |

---

## Environment variables

```dotenv
# Core
DATABASE_URL=postgresql://lumina:lumina@localhost:5432/lumina
REDIS_URL=redis://localhost:6379
JWT_SECRET=change-me

# Object storage (S3-compatible)
S3_ENDPOINT=http://localhost:9000
S3_BUCKET=lumina-media
S3_ACCESS_KEY=...
S3_SECRET_KEY=...
CDN_BASE_URL=https://cdn.example.com

# External data feeds
WEATHER_API_KEY=...
CURRENCY_API_KEY=...
FLIGHTS_API_KEY=...        # AeroAPI / AviationStack / airport FIDS

# Prayer times (defaults; per-screen overrides in dashboard)
PRAYER_CALCULATION_METHOD=UmmAlQura
```

---

## External integrations

| Domain | Suggested provider(s) | Notes |
|---|---|---|
| Prayer times | `adhan` (local compute) | Offline; pick method per region (UmmAlQura, MWL, Egyptian…) |
| Athan audio | self-hosted licensed audio | Source/licensing is your responsibility |
| Weather | Open-Meteo (free), OpenWeatherMap | Open-Meteo needs no key |
| Currency | exchangerate.host, Open Exchange Rates | Cache; refresh on a schedule |
| Flights | AeroAPI, AviationStack, airport FIDS | Real airports often expose their own feed |
| News/RSS | any RSS feed | Polled by the worker, normalized to a ticker |

> All feeds are polled by the **worker** on a schedule, cached in Redis/Postgres, and pushed to
> players — players never call third-party APIs directly (keeps keys safe and screens resilient).

---

## Project status & roadmap

🚧 Pre-MVP / foundations. See **[ROADMAP.md](./ROADMAP.md)** for the phased plan.

---

## Contributing

Conventional Commits, PRs against `develop`, CI must pass (lint + typecheck + test). See
`CONTRIBUTING.md` _(to be added)_.

---

## License

TBD — choose before first external contribution (e.g. proprietary for a commercial SaaS, or
AGPL-3.0 if you want a source-available model).