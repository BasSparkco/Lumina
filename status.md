# Lumina — Daily Progress Log (Archive: Phases 0–4)

## How to use this file
- This file holds the history through Phase 4, back when one person logged everything here.
- **As of Phase 5, this file is frozen** — don't add new entries below. The team now works in
  parallel, each logging to its own file so daily entries never conflict:
  - Backend track (Phase 5) → [status-backend.md](./status-backend.md)
  - Frontend track (Phase 5) → [status-frontend.md](./status-frontend.md)
  - Player app work has no separate log/roadmap file — it's tracked inline in
    [Roadmap.md](./Roadmap.md)'s phases (Phase 1 PWA player, Phase 2 video, Phase 6 native/MQTT).
- See [Roadmap.md](./Roadmap.md) Phase 5 for the backend/frontend split task list.

---

## Phase legend
| Symbol | Meaning |
|--------|---------|
| ✅ | Done |
| 🔄 | In progress |
| ⬜ | Not started |

---

## Session log

### 2026-06-06 — Phase 3 kickoff (same day, continued)

**Phase status at start of session:**
| Phase | Status |
|-------|--------|
| Phase 0 — Foundations | ✅ Complete |
| Phase 1 — MVP slideshow | ✅ Complete |
| Phase 2 — Video, audio & real-time | ✅ Complete |
| Phase 3 — Layouts, themes, scheduling | ✅ Complete |
| Phase 4 — Faith module & live data | ✅ Complete |
| Phase 5 — Multi-tenant, RBAC, ops | ⬜ |

**Finished steps (Phase 0 + Phase 1 recap):**
- ✅ Monorepo scaffold (Turborepo + pnpm): `api`, `dashboard`, `worker`, `player`, `packages/*`
- ✅ Shared tooling: TypeScript, ESLint, Prettier
- ✅ Docker Compose: Postgres (5434), Redis (6381), MinIO (9010/9011)
- ✅ NestJS API skeleton with health, config, Pino logging
- ✅ Next.js dashboard with RTL + next-intl (en/ar)
- ✅ Prisma schema + 2 migrations applied (incl. tenant isolation via `organizationId`)
- ✅ Auth: register / login / JWT (user + player JWTs)
- ✅ Entities: Organization, User, Screen, Asset, Playlist, PlaylistItem
- ✅ Asset upload → MinIO; metadata in Postgres
- ✅ Worker: image thumbnail generation via sharp + BullMQ
- ✅ Screen pairing flow (6-char code on player → dashboard entry)
- ✅ Player PWA: pairing page, timed slideshow, IndexedDB offline cache, heartbeat
- ✅ Dashboard: login, register, asset library, playlist builder, screens list, assign playlist

**Phase 2 work done this session:**
- ✅ WebSocket gateway (`ScreenGateway`) in NestJS — players join `screen:{id}` room, dashboards join `org:{id}` room
- ✅ Redis pub/sub adapter (`RedisIoAdapter`) for horizontal API scaling
- ✅ Player command channel: `publish` (reload playlist), `reload` (reload page), `clear-cache` (wipe IDB + reload)
- ✅ Dashboard: live screen status badge via WS (`useScreenSocket` hook — no manual refresh needed)
- ✅ Dashboard: Publish and Reload buttons per screen (POST `/v1/screens/:id/publish`, `/v1/screens/:id/reload`)
- ✅ Playlist assign now instantly pushes `publish` command to the screen via WS
- ✅ Heartbeat pushes `screen-status: ONLINE` to dashboard org room in real-time
- ✅ Worker: FFmpeg video transcoding (H.264/AAC MP4, max 1080p, faststart) + thumbnail extraction
- ✅ Player: video `<video>` element with `onEnded` advance + hidden preload element for next video
- ✅ Player: `cache.clear()` method added to IndexedDB lib

**Phase 3 work done this session:**
- ✅ Prisma schema: `Layout`, `Zone`, `Schedule` models + migration `phase3-layouts-schedules`
- ✅ API: Layouts CRUD (`GET/POST/PUT/DELETE /v1/layouts`) with zone sub-records
- ✅ API: Schedules CRUD (`GET/POST/PUT/DELETE /v1/schedules?screenId=`) with dayparting resolver
- ✅ API: `GET /v1/player/state` — full state endpoint (zones + schedule rules + emergency + default playlist)
- ✅ API: `PUT /v1/screens/:id/emergency` — activate/deactivate emergency override per screen
- ✅ API: `PUT /v1/screens/:id/layout` — assign/remove a layout from a screen
- ✅ Player: `lib/scheduler.ts` — local schedule resolver (works offline, transitions per minute)
- ✅ Player: `lib/db.ts` v2 — added `state` IndexedDB store
- ✅ Player: `ZonePlayer` component — reusable zone slideshow with preloading
- ✅ Player: `PlayerPage` fully rewritten — 3 modes: emergency override, multi-zone layout, schedule-resolved single playlist
- ✅ Dashboard: Layouts page — zone grid builder with visual 16:9 preview, preset templates, playlist assignment per zone
- ✅ Dashboard: Schedules page — full rule editor (name, screen, playlist, priority, days, time range, date range)
- ✅ Dashboard: Screens page updated — layout selector + emergency override toggle per screen
- ✅ Dashboard: Nav updated — Layouts + Schedules links added

**Start here next session:**
> Phase 4 is complete. Phase 5 work is split into two tracks — see
> [status-backend.md](./status-backend.md) and [status-frontend.md](./status-frontend.md) for
> where each track picks up.

---

### 2026-06-06 — Phase 4: Faith module & live data connectors

**Phase 4 work done this session:**
- ✅ Prisma migration `phase4_faith_module`: `ZoneType` enum (MEDIA/PRAYER/WEATHER/CURRENCY/TICKER), `zoneType` + `widgetConfig Json?` on Zone, `prayerMethod` + `athanEnabled` on Screen
- ✅ API: `GET /v1/player/state` now returns `latitude`, `longitude`, `prayerMethod`, `athanEnabled` + zone `zoneType`/`widgetConfig`
- ✅ API: `PUT /v1/screens/:id/prayer` — update screen prayer config (lat/lon/method/athan toggle)
- ✅ API: Layout zone create/update accepts `zoneType` and `widgetConfig`
- ✅ API: `GET /v1/feeds/weather?lat=&lon=` — serves cached weather from Redis (lazy-fetches Open-Meteo on miss)
- ✅ API: `GET /v1/feeds/currency?base=` — serves cached ECB exchange rates from Redis
- ✅ API: `GET /v1/feeds/ticker?url=` — fetches/caches RSS feed via regex parser
- ✅ Worker: `ConnectorsService` with `@nestjs/schedule` cron jobs — weather every 10 min (Open-Meteo), currency every hour (ECB daily XML), RSS on-demand
- ✅ Player: `PrayerZoneWidget` — live prayer times table (adhan library, on-device, offline), next-prayer countdown, athan audio trigger (checks every second, fires within 30s window), Arabic/English RTL support
- ✅ Player: `WeatherWidget` — fetches from feed API, displays icon/temp/condition/humidity/wind, auto-refreshes every 10m
- ✅ Player: `CurrencyWidget` — exchange rate table (configurable base currency, Gulf pairs by default), auto-refreshes hourly
- ✅ Player: `TickerWidget` — smooth scrolling RSS ticker with dual-buffer loop, gradient fade edges
- ✅ Player: `ZoneRenderer` — routes zones by `zoneType` (PRAYER → PrayerZoneWidget, WEATHER → WeatherWidget, CURRENCY → CurrencyWidget, TICKER → TickerWidget, MEDIA → ZonePlayer)
- ✅ Dashboard: Screens page — "Configure faith settings" panel per screen (lat/lon, calculation method dropdown, athan toggle)
- ✅ Dashboard: Layouts page — zone type dropdown per zone, widget config fields per type (prayer method/athan, weather lang, currency base, RSS URL), 'Mosque' preset added
- ✅ All 4 apps typecheck clean

---

## Phase 2 checklist (detailed)

| # | Task | Status |
|---|------|--------|
| 2.1 | NestJS WebSocket gateway (`ScreenGateway`) | ✅ |
| 2.2 | Redis pub/sub adapter for horizontal scaling | ✅ |
| 2.3 | Player subscribes to its own command channel | ✅ |
| 2.4 | API `POST /v1/screens/:id/publish` triggers WS push | ✅ |
| 2.5 | Dashboard live screen status (online/offline badge updates in real-time) | ✅ |
| 2.6 | Worker: FFmpeg video transcoding job | ✅ |
| 2.7 | Asset upload accepts `video/*` and `audio/*` | ✅ (was already in place) |
| 2.8 | Player: `<video>` element with preloading + buffering strategy | ✅ |
| 2.9 | Background audio track support in player | ⬜ (Phase 3 candidate) |

---

## Phase 3 checklist (upcoming)

| # | Task | Status |
|---|------|--------|
| 3.1 | Layout model: zones per screen | ✅ |
| 3.2 | Player multi-zone renderer | ✅ |
| 3.3 | Theme model + starter themes | ⬜ (deferred — needs design system) |
| 3.4 | Editable fields (prices, text) | ⬜ (deferred with themes) |
| 3.5 | Schedule model: dayparting + day-of-week + date ranges | ✅ |
| 3.6 | Schedule resolver (API + player local) | ✅ |
| 3.7 | Local scheduler in player (offline-capable, per-minute check) | ✅ |
| 3.8 | Emergency override endpoint | ✅ |

---

## Phase 4 checklist (upcoming)

| # | Task | Status |
|---|------|--------|
| 4.1 | `packages/prayer`: adhan wrapper, per-screen location | ✅ |
| 4.2 | On-device prayer time computation in player | ✅ |
| 4.3 | Athan audio playback at correct times | ✅ |
| 4.4 | Prayer-times widget/zone + countdown | ✅ |
| 4.5 | Full RTL polish (Arabic) dashboard + player | ✅ |
| 4.6 | Connector framework (poll → normalize → cache → push) | ✅ |
| 4.7 | Weather connector (Open-Meteo) | ✅ |
| 4.8 | Currency connector (ECB daily XML) | ✅ |
| 4.9 | Flights/FIDS connector | ⬜ (deferred — needs API key) |
| 4.10 | RSS/news ticker connector | ✅ |

---

## Key URLs (local dev)

| App | URL |
|-----|-----|
| Dashboard | http://localhost:3000 |
| API + Swagger | http://localhost:4000/docs |
| Player | http://localhost:5000 |
| MinIO console | http://localhost:9011 (lumina / luminasecret) |
| Prisma Studio | http://localhost:5555 (`pnpm db:studio`) |

## Start infra each day

```bash
docker compose -f infra/docker/docker-compose.yml up -d
pnpm dev
```
