# Tenant-Isolation Ownership Matrix

**Snapshot commit:** `4114f3b6a03fc7ad0ce914596722835ad3f5dffd` (main, 2026-09-05)
**Classification rules:** see `docs/adr/tenant-isolation-and-shared-content.md`
**Classes:** tenant-private (TP) · platform-shared (PS) · platform-private (PP) · device-private (DP) · public (PUB)

## Keeping this current

This was a hand-built P0 snapshot; P9 (`docs/tenant_isolation_and_platform_admin_plan.md`, P9 task 9) has since added the generated equivalent: `apps/api/scripts/generate-ownership-inventory.ts` (`pnpm --filter api run generate:ownership-inventory`) reads `apps/api/prisma/schema.prisma`, every controller's route decorators, `apps/api/src/modules/ws/screen.gateway.ts`, and `storage.service.ts`'s key-builder templates, and writes `docs/tenant-isolation/ownership-inventory.generated.json`. CI regenerates it and fails the build on any diff from what's checked in, or if the generator reports an UNCLASSIFIED model (see `MODEL_CLASS_OVERRIDES` in that script). This hand-written file remains the human-readable narrative — the *notes* column here (why a relation is safe, what trigger enforces it, what's still a known gap) is exactly what a mechanical scan can't produce — but the exhaustive, always-current model/route/event/prefix listing now lives in the generated JSON; update this file by hand only for the narrative/notes, and treat the generated JSON as authoritative for "does every model/route/event/prefix have a classification."

Two items below are flagged rather than force-fit into one class, because they don't cleanly match the five-class model as it stands today — see their notes.

---

## 1. Prisma models

All models in `apps/api/prisma/schema.prisma` (41 total).

| Model | Class | Ownership path / notes |
|---|---|---|
| Organization | PP | Tenant registry root itself; has no parent to be owned by |
| User | TP | Direct `organizationId` |
| TenantModule | PP | Direct `organizationId`; module/entitlement assignment is platform administration over a tenant |
| OrgInvite | TP | Direct `organizationId` |
| AuditLog | TP | Direct `organizationId`. **P5a (done):** `userId`, when present, is now DB-enforced to belong to the same org as the row — a hand-written trigger (`auditlog_actor_same_org`, migration `20260905223040_...`) rejects any INSERT/UPDATE that violates it (a composite FK couldn't be used here since `organizationId` is required but `User` deletion must still `SET NULL` only `userId`). The historical cross-org rows (Super Admin tenant-management actions) were moved to `PlatformAuditLog` — `AuditLog.userId` can now be treated as same-org, unlike before |
| PlatformAuditLog | PP | No `organizationId` (P3) — for actions with no target tenant (shared-library mutations). **P5a (done):** gained a nullable `targetOrganizationId` (`SetNull` on that org's deletion) for actions that *do* target one tenant but are authored by a different-org actor (Super Admin tenant create/status/module/owner-invite) — `PlatformTenantsService`/`EntitlementsService.setTenantModules` write here now instead of the target tenant's own `AuditLog`. `actorUserId` nullable + `SetNull`, same pattern as `AuditLog.userId` |
| Screen | TP | Direct `organizationId`, **NOT NULL** (P5a schema task 4, done 2026-09-06). `POST /player/init` no longer creates a Screen row at all — it creates a short-lived `PairingSession` (no organizationId; not tenant data), and `ScreensService.confirmPairing` claiming it creates the real Screen already tenant-owned, transactionally, reusing the session's id. **P5a schema task 2 (done 2026-09-06):** `check_screen_tenant_refs` trigger enforces playlistId/emergencyPlaylistId/assetId/groupId all resolve to it (assetId allows a shared, `organizationId IS NULL` asset) |
| PairingSession | N/A — not tenant data | No `organizationId`; a claim ticket for an unclaimed `POST /player/init` request, deleted the moment it's claimed (becomes a Screen) or reaped by `apps/worker`'s pairing-cleanup cron past the shared TTL. Added P5a schema task 4 |
| ScreenGroup | TP | Direct `organizationId` |
| ProofOfPlayLog | TP | Direct `organizationId` |
| KioskEvent | TP | Direct `organizationId` |
| ScreenAlert | TP | Direct `organizationId` |
| CrashReport | TP | Direct `organizationId` |
| Asset | TP / PS (nullable org) | Direct `organizationId`, nullable by design: real org id = tenant asset, `null` = stock/library asset (`platform/assets/...` storage prefix, P3-renamed from `system/assets/...`; no existing rows to migrate — the library was empty). This is a legitimate shared-content null, unlike `Screen` above. `sourceLibraryAssetId` (P3) marks a tenant's own copy of a library original and gates who may ever delete the shared storage object — see AssetsService.remove/removeFromLibrary |
| AssetBinary | TP / PS (inherited) | Via `assetId → Asset.organizationId`; inherits Asset's tenant-vs-shared split |
| Playlist | TP | Direct `organizationId` |
| PlaylistItem | TP | Direct `organizationId` (P5a schema task 1, done 2026-09-06 — backfilled from `playlistId → Playlist.organizationId`; `check_playlistitem_tenant_refs` trigger enforces assetId/themeId/layoutId/designAssetId all resolve to it) |
| Layout | TP | Direct `organizationId` |
| Zone | TP | Direct `organizationId` (P5a schema task 1, done 2026-09-06 — backfilled from `layoutId → Layout.organizationId`; `check_zone_tenant_refs` trigger enforces layoutId/playlistId/assetId all resolve to it) |
| Theme | TP / PS (nullable org) | Direct `organizationId`, nullable = system preset theme, same pattern as Asset |
| DesignTemplate | PP | No `organizationId` at all — Super-Admin-owned catalog, not tenant data. **P5a bonus (done 2026-09-06):** `check_designtemplate_thumbnail_shared` trigger enforces `thumbnailAssetId` references only a shared (`organizationId IS NULL`) asset, never a tenant-owned one — a platform-visible template could otherwise leak a reference to one specific tenant's private asset |
| DesignTemplateVersion | PP | Via `templateId → DesignTemplate`; immutable publish snapshot, already implemented |
| DesignTemplateTenant | **Flagged — join table** | Composite PK `[templateId, tenantId]`; an access-grant record between platform-private `DesignTemplate` and `Organization`, not itself tenant-owned data. Treat writes to it as platform-private (Super Admin only) and reads as "does this org have access" rather than assigning it one of the five classes directly |
| DesignAsset | TP | Direct `organizationId`. **P5a (done 2026-09-06):** `check_designasset_tenant_refs` trigger enforces `thumbnailAssetId` resolves to it (allows a shared asset) |
| DesignAssetVersion | TP | Via `designAssetId → DesignAsset.organizationId` |
| DesignDraft | TP | Direct `organizationId`. **P5a (done):** `documentId` is client-generated and is no longer globally `@unique` — uniqueness is now `@@unique([organizationId, documentId])`, so a client-supplied id can only ever resolve within its own org |
| Building | TP | Direct `organizationId` |
| Floor | TP | Direct `organizationId` (P5a schema task 1, done 2026-09-06 — backfilled from `buildingId → Building.organizationId`; `check_floor_tenant_refs` trigger enforces buildingId/floorPlanAssetId resolve to it) |
| PoiCategory | TP / PS (nullable org) | Direct `organizationId`, nullable = system default category, same pattern as Asset/Theme |
| Poi | TP | Direct `organizationId` (P5a schema task 1, done 2026-09-06 — backfilled from `floorId → Floor.organizationId`; `check_poi_tenant_refs` trigger enforces floorId/categoryId/iconAssetId resolve to it) |
| PoiAlias | TP | Via `poiId → Poi → Floor → Building.organizationId` |
| KioskLocation | TP | Direct `organizationId` (P5a schema task 1, done 2026-09-06 — backfilled from `screenId → Screen.organizationId`; `check_kiosklocation_tenant_refs` trigger enforces screenId/floorId/attractPlaylistId/attractThemeId resolve to it) |
| RouteNode | TP | Direct `organizationId` (P5a schema task 1, done 2026-09-06 — backfilled from `floorId → Floor.organizationId`; `check_routenode_tenant_refs` trigger enforces floorId resolves to it) |
| RouteEdge | TP | Direct `organizationId` (P5a schema task 1, done 2026-09-06 — backfilled from `fromNodeId → RouteNode.organizationId`; `check_routeedge_tenant_refs` trigger enforces fromNodeId **and** toNodeId both resolve to it, structurally preventing an edge from linking two tenants' route graphs) |
| WayfindingAiScreenConfig | TP | Via `screenId → Screen.organizationId` |
| WayfindingAiUsageLog | TP | Direct `organizationId` |
| BookableRoom | TP | Direct `organizationId`. **P5a (done 2026-09-06):** `check_bookableroom_tenant_refs` trigger enforces `wayfindingPoiId` resolves to it — closes the plan's own named schema-task-5 target |
| RoomDisplayBinding | TP | Direct `organizationId` (P5a schema task 1, done 2026-09-06 — backfilled from `roomId → BookableRoom.organizationId`; `check_roomdisplaybinding_tenant_refs` trigger enforces roomId/screenId both resolve to it — closes the prior "known gap" of room/screen org mismatch having no DB constraint) |
| RoomReservation | TP | Direct `organizationId` (P5a schema task 1, done 2026-09-06 — backfilled from `roomId → BookableRoom.organizationId`; `check_roomreservation_tenant_refs` trigger enforces roomId resolves to it) |
| RoomCalendarConnection | TP | Direct `organizationId` |
| Schedule | TP | Direct `organizationId`. **P5a (done 2026-09-06):** `check_schedule_tenant_refs` trigger enforces playlistId/screenId both resolve to it |
| PowerSchedule | TP | Direct `organizationId`. **P5a (done 2026-09-06):** `check_powerschedule_tenant_refs` trigger enforces screenId/groupId both resolve to it |

## 2. API routes

All 32 controllers under `apps/api/src/modules/*`. Guard column reflects the effective stack (class-level + method-level).

### Public (no auth, or authorized by a narrow non-JWT mechanism)

| Route | Actual gate | Notes |
|---|---|---|
| `POST /auth/register` | `@Throttle(5/60s)` | Public by design |
| `POST /auth/login` | `@Throttle(5/60s)` | Public by design |
| `POST /org/invite/accept` | invite token in body | No guard — token is the sole check; P1 adds the token-preview `GET /org/invite/:token` and fixes the accept race |
| `POST /player/init` | `@Throttle(20/60s)` | Creates a real, possibly-unowned `Screen` row — P4/P5a target |
| `GET /player/check` | `@Throttle(100/60s)` | Pairing-status poll |
| `POST /room-booking/integrations/microsoft365/webhook` | Graph `clientState` match | External Microsoft Graph callback, not a Nest guard |
| `GET /playlists/:id/preview` | `?token=` query param minted by `POST /playlists/:id/preview-token` | Deliberately outside `JwtAuthGuard`/`RolesGuard` — see code comment in `playlists.controller.ts` |

### Media routes — token-authorized, not guard-authorized (P4 done; see §4 below)

| Route | Notes |
|---|---|
| `GET /media/assets/:assetId`, `/thumbnail`, `/pages/:page` | `?token=` minted by `StorageService`, verified by `MediaTokenService` — resolves by `assetId`, never a client-supplied path |
| `GET /media/binaries/:binaryId` | Same pattern, for `AssetBinary` rows (the offline-manifest integrity path) |
| `GET /media/screens/:screenId/screenshot` | Same pattern; also 404s if the screen has no `organizationId` or no screenshot yet |
| `GET /media/:orgId/assets/:filename`, `GET /media/:orgId/screenshots/:filename` | **Legacy, deliberately still running** (P9 rollout step 6) — no guard, no token, key built from the client-supplied `:orgId`. Nothing mints this shape anymore; each hit now logs a warning (fleet-refresh signal for P4 task 10's eventual removal) |

### Platform-private (Super Admin only)

| Route | Notes |
|---|---|
| `GET /org/all` | `SuperAdminGuard` |
| `GET/POST/PUT /admin/tenants*` (6 routes) | `PlatformTenantsController` |
| `GET/POST/PUT/DELETE /admin/templates*` (9 routes) | `AdminTemplatesController` |

### Tenant-private (JwtAuthGuard + RolesGuard, optionally + EntitlementGuard/@Roles)

Everything else — all routes in `apps.controller.ts`, `assets.controller.ts` (non-media, non-library-write), `audit.controller.ts`, `designs.controller.ts` (both controllers), `layouts.controller.ts`, `org.controller.ts` (member/invite/settings routes), `playlists.controller.ts` (non-preview), `power-schedules.controller.ts`, `proof-of-play.controller.ts`, `schedules.controller.ts`, `screen-groups.controller.ts`, `screens.controller.ts`, `themes.controller.ts`, `templates.controller.ts` (customer routes), the `wayfinding*` controllers (+`EntitlementGuard`/`RequireModule('WAYFINDING')` or `'WAYFINDING_AI'`), and the `room-booking*` controllers (+`RequireModule('ROOM_BOOKING')`) — roughly 150 routes.

**P3 (done):** the three shared-library write routes below no longer carry `@Roles('LIBRARY_MANAGER')` — that role granted platform write authority through a tenant role, which was itself the P3 defect. They now carry method-level `SuperAdminGuard` + `@RequireSuperAdmin()` alongside this section's class-level guards, so a live-checked Super Admin is required regardless of tenant role. `LIBRARY_MANAGER` is removed from the `UserRole` enum (schema.prisma) and from the dashboard's invite/role-management UI; `db:audit-library-manager` found exactly one holder in this database (a 2026-08-25 smoke-test fixture, not a real tenant), migrated to `EDITOR` before the enum-value migration ran.

| Route | Notes |
|---|---|
| `POST /assets/library` | `SuperAdminGuard` + `@RequireSuperAdmin()` |
| `PUT /assets/library/:id` | Same |
| `DELETE /assets/library/:id` | Same |

### Device-private (PlayerJwtGuard)

All routes in `player.controller.ts` except `init`/`check` (10 routes: `playlist`, `state`, `manifest`, `unpair`, `heartbeat`, `proof-of-play`, `wayfinding-events`, `screenshot`, `crash-report`), `feeds.controller.ts` (3 routes), `room-booking-player.controller.ts` (`book-now`), `wayfinding-ai-player.controller.ts` (`resolve`).

## 3. WebSocket surface

`apps/api/src/modules/ws/screen.gateway.ts` (`ScreenGateway`) — the only gateway in the codebase.

| Item | Class | Notes |
|---|---|---|
| Room `screen:${screenId}` | DP | Joined at `handleConnection` from a verified player JWT's `sub`, never client-supplied |
| Room `org:${orgId}` | TP | Joined at `handleConnection` from a verified dashboard JWT's `orgId`, never client-supplied |
| Event `command` (server→screen room) | DP | |
| Event `screen-status` (server→org room) | TP | |
| Event `screen-unpaired` (server→org room) | TP | |
| Event `playback-progress` (client→server, rebroadcast to org room) | TP | Guarded in-handler by `client.data.screenId`/`orgId` set at connect time, not by re-validating the room on each message |
| Event `ack` (client→server) | DP | Logs only |

**P2 target:** `handleConnection` currently does signature/expiry verification only — no live DB check that the user/screen/org still exists, is unsuspended, or matches the current `authVersion`. This is the WebSocket half of the P2 exit gate.

## 4. Storage prefixes

All key patterns constructed in `apps/api/src/modules/storage/storage.service.ts` and the services that call it.

| Prefix | Class | Constructed in | Notes |
|---|---|---|---|
| `${orgId}/assets/${uuid}.${ext}` | TP | `assets.service.ts` (`upload`, stock-import, icon-fetch paths) | |
| `${orgId}/assets/tmp/${uuid}.${ext}` | TP | `assets.service.ts` (audio-extraction staging) | Transient |
| `${orgId}/assets/${uuid}.m4a` | TP | `assets.service.ts` (audio-extraction target) | |
| `${orgId}/text/${uuid}`, `${orgId}/app/${uuid}` | TP | `assets.service.ts` (`createText`, app/embed assets) | Pseudo-keys — no real object behind them |
| `${orgId}/screenshots/${screenId}.jpg` | DP | `storage.service.ts` `screenshotKey()`, written by `player.service.ts`, read/deleted by `media.controller.ts` | Deterministic (cuid `screenId`, not a random UUID) — served with the shortest media-token TTL (5 min, P4 task 6) |
| `platform/assets/${uuid}.${ext}` | PS | `assets.service.ts` `uploadToLibrary()`, `prisma/seed-library.ts` | P3 task 5: renamed from `system/assets/...` to the plan's literal `platform/...` prefix. No migration needed — the library had zero rows at the time of the rename (verified against this database), so nothing pointed at the old prefix |
| `<key>_p${n}.webp` | inherits source | `apps/worker/src/processors/media.processor.ts` (written); `StorageService.documentPageKey()` (read, P4) | Derived by string-replace on the asset's own `storageKey`; no independent prefix scheme. `documentPageUrls()` (the pre-P4 URL builder in `player.service.ts`/`playlists.service.ts`) is gone — replaced by `StorageService.assetPageUrls()` |
| `<key>_thumb.webp`, `<key>_transcoded.mp4` | inherits source | `apps/worker/src/processors/media.processor.ts` | Same string-replace derivation; served as `Asset.thumbnailKey`/binary-transcode output, not through a separate route |

**P4 (done):** raw storage keys are never embedded in a client-facing URL anymore. `media.controller.ts` now resolves every request by database identity — `GET /media/assets/:assetId`, `GET /media/assets/:assetId/thumbnail`, `GET /media/assets/:assetId/pages/:page`, `GET /media/binaries/:binaryId`, `GET /media/screens/:screenId/screenshot` — each requiring a short-lived signed `?token=` minted by the new `MediaTokenService` (`modules/storage/media-token.service.ts`) via `StorageService.assetUrl()`/`assetThumbnailUrl()`/`assetPageUrl()`/`assetBinaryUrl()`/`screenshotUrl()`. `StorageService.publicUrl()` (the old raw-key URL builder) is deleted — every call site migrated. The legacy `GET /media/:orgId/assets/:filename` and `GET /media/:orgId/screenshots/:filename` routes are kept running deliberately (P9 rollout step 6) but log a warning on every hit; see `docs/tenant-isolation/README.md`'s P4 status for the retirement plan (task 10) and the deferred object-storage reconciliation job (task 9).

## 5. Dashboard routes

`apps/dashboard/src/app/[locale]/`.

| Route | Class | Notes |
|---|---|---|
| `/dashboard`, `/screens`, `/assets`, `/playlists`, `/templates`, `/layouts` (legacy redirect), `/designer`, `/designer2`, `/schedules`, `/power-schedule`, `/wayfinding`, `/wayfinding/ai`, `/room-booking`, `/reports`, `/members`, `/settings`, `/billing`, `/audit-log` | TP | `/members` is now real (P1 done — `membersApi`, no `mocks/members` import). `/billing`, `/audit-log`, `/reports`'s proof-of-play, and screen-group tagging inside `/screens` are still backed by `localStorage` mocks — P8 targets. `/billing` is additionally hidden from nav (`visible: () => false`) and route-guarded off (`useRouteGuard(false)`), so it's dormant, not actively exposed |
| `/admin/templates` | PP | Super-Admin gated in the sidebar (`visible: p => p.isSuperAdmin`) |
| `/admin/tenants`, `/admin/tenants/[tenantId]` | PP | Super-Admin gated, same pattern |
| `/accept-invite`, `/login`, `/register` | PUB | `/accept-invite` currently calls the mock, not the real `POST /org/invite/accept` — P1 target |
