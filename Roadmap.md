# Roadmap — Lumina Signage

A phased plan from foundations to a scalable, multi-tenant signage platform. Each phase ends with
a usable increment. **Don't skip Phase 1's player work** — the player is the hardest, most
underestimated part of any signage product, so it's tackled early and deliberately.

Legend: ☐ todo · ◐ in progress · ☑ done

---

## Phase 0 — Foundations (Weeks 1–2) ✅ COMPLETE

Goal: a clean monorepo and the skeleton everything else hangs on.

- ☑ Monorepo scaffold (Turborepo + pnpm): `dashboard`, `api`, `worker`, `player`, `packages/types`
- ☑ Shared tooling: TypeScript, ESLint, Prettier, commit hooks, Conventional Commits
- ☑ Docker Compose for local infra: Postgres (5434), Redis (6381), MinIO (9010/9011)
- ☑ NestJS API skeleton with health check, config module, logging (Pino)
- ☑ Next.js dashboard skeleton with RTL-ready layout + i18n scaffolding (next-intl en/ar)
- ☑ Prisma schema bootstrap + first migration (tenant isolation from day 1)
- ☐ CI pipeline: install → lint → typecheck → test → build

**Exit criteria:** `pnpm dev` boots all apps; CI is green.

---

## Phase 1 — MVP: one screen, one slideshow (Weeks 3–6) ✅ COMPLETE

Goal: a user can sign up, upload images, pair a screen, and see a timed slideshow play. The
single most important milestone — it proves the end-to-end loop.

**Backend / data**
- ☑ Auth: email/password, JWT, single organization per user
- ☑ Entities: `Organization`, `User`, `Screen`, `Asset`, `Playlist`, `PlaylistItem`
- ☑ Media upload → S3/MinIO; store metadata only in Postgres
- ☑ Worker: generate thumbnails on upload (sharp, BullMQ)
- ☑ Screen pairing flow (player shows code → user enters it in dashboard)

**Player (PWA)**
- ☑ Pairing screen + token storage
- ☑ Fetch assigned playlist; render timed image slideshow
- ☑ Offline cache (Service Worker + IndexedDB) — keep playing without network
- ☑ Heartbeat to API (online / last-seen / current item)
- ☑ Auto-recovery: reload on crash, resume on boot

**Dashboard**
- ☑ Asset library (upload, list, delete)
- ☑ Playlist builder (order items, set per-image duration)
- ☑ Screen list with online/offline status
- ☑ Assign a playlist to a screen

**Exit criteria:** Upload images → build a playlist → pair a real device (or kiosk browser) →
slideshow plays and survives a network drop.

---

## Phase 2 — Video, audio & real-time publishing (Weeks 7–10) 🔄 IN PROGRESS

Goal: rich media and instant updates.

- ☑ Video upload + transcoding/normalization pipeline (FFmpeg in worker, BullMQ)
- ☑ Video playback in player with preloading
- ☐ Background audio track layered under image playlists
- ☑ Webapiet gateway (NestJS) — push "publish" / "reload" to players instantly
- ☑ Redis pub/sub so WS scales across multiple API instances
- ☑ Player command channel: publish, reload, clear-cache, reboot
- ☑ Dashboard: live screen status via WS (no manual refresh)

**Exit criteria:** Change a playlist in the dashboard → screen updates within seconds, no manual
refresh; video and background audio play smoothly.

---

## Phase 3 — Layouts, themes, scheduling (Weeks 11–16) ✅ COMPLETE (themes deferred)

Goal: the features that make it a real product, not a slideshow.

**Layouts & zones**
- ☑ Layout model: split a screen into zones, each running its own playlist
- ☑ Player renders multi-zone layouts (e.g. main + sidebar + bottom ticker)

**Themes / templates**
- ☐ Theme model: pre-built, editable designs (deferred — needs design system)
- ☐ Starter themes: restaurant/café menu, retail promo, lobby, clinic
- ☐ Editable fields (e.g. menu prices) without touching the design
- ☐ Dynamic data fields bound to a feed/sheet (auto-update prices/values)

**Scheduling**
- ☑ Schedule model: dayparting + day-of-week + date ranges
- ☑ Resolver decides what each screen plays "right now" (API + player local)
- ☑ Local scheduler in player (works offline, transitions on time)
- ☑ Emergency override: instantly take over selected/all screens

**Exit criteria:** A café owner picks a menu theme, edits prices, sets a breakfast/lunch
schedule, adds a ticker zone, and publishes — all without design skills.

---

## Phase 4 — Faith module & live data connectors (Weeks 17–21) ✅ COMPLETE

Goal: the regional differentiators and the airport/API use cases.

**Prayer module**
- ☑ `packages/prayer`: prayer-time engine (adhan), per-screen location + method
- ☑ On-device computation in player (offline-capable)
- ☑ Athan audio playback at correct times
- ☑ Prayer-times widget/zone + next-prayer countdown
- ☑ RTL Arabic support across prayer widget and data widgets

**Data connectors (worker-polled, never called from the player)**
- ☑ Connector framework: poll → normalize → cache (Redis) → serve via API
- ☑ Weather connector (Open-Meteo — free, no API key)
- ☑ Currency connector (ECB daily XML — free)
- ☐ Flights connector (AeroAPI / AviationStack) — deferred, needs API key
- ☑ RSS/news ticker connector + scrolling TickerWidget
- ☑ Data widgets: WeatherWidget, CurrencyWidget, TickerWidget, PrayerZoneWidget
- ☑ Zone type routing in player (MEDIA/PRAYER/WEATHER/CURRENCY/TICKER)
- ☑ Dashboard: faith settings per screen + zone type selector in layout builder

**Exit criteria:** A mosque shows prayer times + athan offline; an airport screen shows live
flights, weather, and currency from cached feeds.

---

## Phase 5 — Multi-tenant teams, RBAC & operations (Weeks 22–27)

Goal: ready for real customers and teams.

- ☐ Multiple users per org with roles (owner, admin, editor, viewer)
- ☐ Role-based permissions across all resources
- ☐ Screen groups & tags — bulk publish by location/group
- ☐ Content approval workflow (editor submits → admin approves)
- ☐ Proof-of-play logging + reporting/export
- ☐ Fleet monitoring dashboard (uptime, last-seen, alerts on offline screens)
- ☐ Audit log
- ☐ Billing/subscriptions (Stripe) + per-screen plan limits

**Exit criteria:** A team with mixed roles manages dozens of screens across locations with
approvals, billing, and proof-of-play.

---

## Phase 6 — Scale, hardening & growth (ongoing)

- ☐ MQTT transport for the player fleet (replace/augment WS at scale)
- ☐ Native Android player (wrap PWA in WebView; auto-start on boot)
- ☐ Smart-display targets (Samsung Tizen / LG webOS) as demand appears
- ☐ White-label / reseller mode (branding per reseller, sub-accounts)
- ☐ Designer/canvas (drag-and-drop template editor)
- ☐ Interactivity: touch kiosks, QR codes
- ☐ Audience analytics (dwell time, optional camera-based counts) — privacy-reviewed
- ☐ Mobile admin app
- ☐ Security & compliance: SSO, GDPR tooling, penetration test, SOC 2 path
- ☐ Observability: Prometheus/Grafana dashboards, alerting, SLOs

---

## Cross-cutting concerns (apply every phase)

- **Offline-first** — assume the network is unreliable; the player must always keep playing.
- **Security** — tenant isolation, signed media URLs, never expose API keys to players.
- **RTL & i18n** — design for Arabic/Hebrew from day one, not as a retrofit.
- **Testing** — unit + integration on the API; a player simulator for playback/scheduling logic.
- **Performance** — video on cheap hardware is the real constraint; profile on actual devices.

---

## Suggested first sprint (concrete)

1. Phase 0 scaffold complete.
2. Auth + `Organization`/`User`/`Screen`/`Asset`/`Playlist` entities.
3. Image upload to MinIO + thumbnails.
4. Pairing flow + PWA player rendering a timed slideshow with offline cache.

That single vertical slice de-risks the whole project, because it forces every layer —
dashboard, API, storage, worker, and the player — to talk to each other once.