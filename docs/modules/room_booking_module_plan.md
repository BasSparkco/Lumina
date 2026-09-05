# Room Booking Signage Module — Implementation Plan

**Status:** Ready for implementation review  
**Repository:** `https://github.com/BasSparkco/Lumina`  
**Reviewed baseline:** `bdee2b839449c86d5d98000dfb9e55e67cc0d059` on `main` (2026-09-05)  
**Repository planning baseline:** commit P `fe643d22d1f280e31b2ccdbe3502aeb9138e3beb` — reviewed and approved  
**Foundation:** `platform-modules-foundation-v1`; Platform Modules and Tenant Entitlements Phases A/B are complete  
**Required underlying AI implementation commit:** `<record verified AI implementation commit C during its docs handoff>`  
**Required branch baseline:** docs-only handoff commit D on verified post-AI `main`; record D's full hash in the Room Booking execution/PR log before RB1  
**Commercial module key:** `ROOM_BOOKING`  
**Optional module dependency:** None

---

## 1. Outcome

Build Room Booking Signage as an independently purchasable Lumina module for screens installed outside meeting rooms. The screen shows the room's current availability, current and upcoming reservations, and—when tenant policy allows—offers a limited **Book Now** action.

The module runs inside the existing Lumina dashboard, API, screen-management flow, WebSocket infrastructure, and player. It is not a separate application and does not require Wayfinding.

The first sellable core release includes Lumina-native rooms and reservations. A provider abstraction is mandatory from the beginning so Microsoft 365 and Google Workspace can be added without rewriting the domain or player. External calendar connectors are separate release milestones because their OAuth, webhook, privacy, recurrence, and reconciliation requirements are materially larger than the signage core.

---

## 2. Repository Assessment

The baseline already provides:

- `ROOM_BOOKING` in `MODULE_KEYS` with no optional-module dependency.
- tenant status, per-tenant entitlement, trials, expiry, and disable/re-enable preservation.
- `@RequireModule()`, `EntitlementGuard`, `GET /v1/org/capabilities`, dashboard module hooks, and Super Admin assignment UI.
- screen pairing, screen JWTs, screen modes, player state, offline presentation persistence, module leases, WebSocket refresh, emergency playlist priority, and screen management.
- schedules and playlists, but these are content playback schedules and must not be reused as room reservations.
- `Building`, `Floor`, and `Poi` under Wayfinding, but Room Booking must remain usable when Wayfinding is not purchased.
- server-side `AuditService`, org-scoping conventions, PostgreSQL/Prisma, BullMQ, and Redis.

No room, room-display binding, reservation, availability, calendar connector, webhook reconciliation, or room-booking player payload exists today.

### 2.1 Required preflight entry gate

All three plan files must first exist in repository planning-baseline commit P and pass the repository-level re-review described by `modules_shared_preflight_plan.md`. The accepted plan corrections and P's hash are committed in reviewed planning handoff commit Q, and the shared preflight starts from Q.

Complete the shared preflight using implementation commit A followed by the handoff commit tagged `modules-shared-preflight-v1`. Then implement and verify AI Wayfinding. Merge verified AI implementation commit C to `main`, record C's full hash in this plan and the AI plan in following docs-only handoff commit D, and start the Room Booking branch from D.

Because commit D cannot contain its own hash, verify and record D's full `git rev-parse HEAD` value in the Room Booking execution/PR log before any Room Booking code change. The logged hash, branch HEAD, and verified post-AI `main` must match. Do not branch directly from C before the plans record it.

This feature branch must not independently reimplement the suspension/evacuation correction, dashboard dependency resolver, B6 heading correction, AI Wayfinding, or shared integration rules. Verify them as prerequisites, then implement only Room Booking work.

---

## 3. Product Decisions to Freeze

### 3.1 Independent commercial module

- Room Booking is sold as `ROOM_BOOKING`.
- It does not require `WAYFINDING`, `WAYFINDING_AI`, or `INDOOR_POSITIONING`.
- A tenant may buy Room Booking without any Wayfinding feature.
- Disabling Room Booking preserves rooms, bindings, reservations, integration mappings, and display settings.
- Re-enabling restores the previous configuration without reconstruction.
- No user-level module purchase override is added.

### 3.2 Same Lumina application, dedicated screen mode

Add `ROOM_BOOKING` to `StreamingType`. A room display is configured from the existing Screens page:

1. choose `ROOM_BOOKING` as the screen mode;
2. bind the screen to one Room Booking room; and
3. configure that binding's display and kiosk-action policy.

Keep prior asset, playlist, and Wayfinding bindings stored across mode changes, following the existing mode-preservation precedent.

### 3.3 Room Booking domain is not the signage schedule domain

Do not reuse `Schedule`, `ScheduleRule`, `Playlist`, or content scheduling tables for meetings. Their semantics, conflict rules, recurrence, organizer privacy, and external provider identities are different.

Create a dedicated room/reservation domain.

### 3.4 Native core and connector profiles

Define two commercial delivery profiles:

| Profile | Included scope | Release condition |
| --- | --- | --- |
| Core | Lumina-native rooms, reservations, dashboard calendar, room displays, Book Now | First sellable release |
| Enterprise Calendar | Core plus one or more external calendar connectors | Required only when a customer contract names the provider |

Recommended connector order:

1. Microsoft 365 / Exchange Online.
2. Google Workspace Calendar.

Do not delay the core domain for both connectors. Do not advertise a connector as supported until its own acceptance milestone passes.

### 3.5 Source of truth

- For a `LUMINA` room, Lumina reservations are authoritative.
- For a `MICROSOFT_365` or `GOOGLE_WORKSPACE` room, the external calendar is authoritative and Lumina stores a normalized local projection/cache.
- Player screens never call Microsoft or Google directly.
- Dashboard and kiosk mutations go through the provider adapter for externally managed rooms.
- Webhooks and periodic reconciliation repair the local projection after external changes or partial failures.

### 3.6 Privacy modes

Each room must have one display privacy policy:

```text
SHOW_TITLE          Show meeting title; hide organizer unless explicitly enabled.
SHOW_ORGANIZER      Show title and organizer display name.
BUSY_ONLY           Show only occupied/free and times.
```

Default to `BUSY_ONLY` for new rooms. Never display attendee lists, email addresses, meeting descriptions, join links, or private event bodies on a public hallway screen.

### 3.7 Kiosk actions

The initial player supports optional **Book Now** only:

- tenant administrator enables it per room display;
- durations come from administrator-approved presets;
- the server uses its own clock and checks conflicts atomically;
- a booking cannot extend into the next reservation;
- the screen cannot choose another room;
- offline booking is forbidden;
- anonymous users cannot cancel, end, extend, or edit existing meetings in the first release.

Check-in, auto-release for no-shows, end-early, extend, attendee invitations, and authenticated employee workflows are later capabilities.

### 3.8 Time handling

- Persist reservation instants in UTC.
- Persist a valid IANA timezone on each room.
- Compute display labels in the room timezone.
- Reject invalid or zero/negative intervals.
- Use half-open intervals `[startsAt, endsAt)` so back-to-back reservations do not conflict.
- Do not use the screen device clock for booking validation.

---

## 4. User Experience

### 4.1 Hallway display

The display must communicate status at a distance:

- **Available** — green, with available-until time.
- **Occupied** — red, with current meeting end time.
- **Starting Soon** — amber when the next reservation is within the configured warning window.
- **Out of Service** — neutral/gray, no booking action.
- **Offline/Stale** — visible but non-alarming status; all write actions disabled.

The detailed view shows:

- room name and location label;
- capacity and selected amenities;
- current status;
- current reservation according to privacy mode;
- next reservation;
- a bounded schedule timeline, normally the remainder of today;
- current local time; and
- Book Now when permitted and safe.

### 4.2 Dashboard

Add `/room-booking` inside the existing authenticated Lumina shell with these sections:

1. **Rooms** — room inventory and settings.
2. **Calendar** — day/week view and native reservation management.
3. **Displays** — eligible screens, room bindings, preview, and kiosk policies.
4. **Integrations** — provider connections and room-resource mapping.
5. **Health** — last sync, webhook status, errors, and stale rooms.

The Integrations section may remain hidden until a connector milestone is implemented.

---

## 5. Architecture

```text
Dashboard or room screen
  -> Room Booking API
     -> tenant/module/role checks
     -> RoomBookingService
        -> NativeCalendarProvider
        -> Microsoft365Provider (optional milestone)
        -> GoogleCalendarProvider (optional milestone)
     -> normalized local reservation projection
     -> ScreenGateway refresh
  -> Player state + ROOM_BOOKING lease
  -> RoomBookingView
```

### 5.1 Provider-neutral domain

Controllers and player-state assembly use `RoomBookingService`; they must not contain Microsoft Graph or Google Calendar request logic.

```ts
interface RoomCalendarProvider {
  listReservations(input: ProviderListInput): Promise<NormalizedReservation[]>;
  createReservation(input: ProviderCreateInput): Promise<NormalizedReservation>;
  cancelReservation?(input: ProviderCancelInput): Promise<void>;
  healthCheck(connectionId: string): Promise<ProviderHealth>;
}
```

The native provider implements the same behavioral contract with PostgreSQL. External adapters translate provider IDs, recurrence, availability, and errors into Lumina-owned types.

### 5.2 Read model for the player

Do not send the complete historical reservation table to the player. Build a bounded display payload from server time:

```ts
interface RoomBookingPlayerPayload {
  room: {
    id: string;
    name: string;
    locationLabel: string | null;
    timezone: string;
    capacity: number | null;
    amenities: string[];
    status: 'ACTIVE' | 'OUT_OF_SERVICE';
  };
  display: {
    privacyMode: 'SHOW_TITLE' | 'SHOW_ORGANIZER' | 'BUSY_ONLY';
    quickBookingEnabled: boolean;
    quickBookingDurationsMinutes: number[];
    startingSoonMinutes: number;
  };
  serverNow: string;
  reservations: Array<{
    id: string;
    startsAt: string;
    endsAt: string;
    title: string | null;
    organizerDisplayName: string | null;
    status: 'CONFIRMED';
  }>;
  generatedAt: string;
  validUntil: string;
}
```

Apply privacy redaction on the server before the payload reaches the player. The player must not receive hidden meeting details and merely hide them with CSS.

---

## 6. Shared Type Changes

Add `packages/types/src/room-booking.ts` with Zod schemas and types for:

- room status;
- privacy mode;
- provider key;
- reservation status, calendar provider, and creation origin;
- room summary/detail;
- availability response;
- display settings;
- player payload;
- Book Now request/response; and
- integration health without secrets.

Explicitly re-export runtime schemas from `packages/types/src/index.ts` because the dashboard and player require analyzable runtime exports.

Add `ROOM_BOOKING` to every local `StreamingType` definition that currently declares only `ASSET | PLAYLIST | WAYFINDING`. Prefer moving this union/schema into `@lumina/types` so Prisma, API DTO validation, dashboard, and player derive from one application contract where practical.

---

## 7. Database Design

### 7.1 `BookableRoom`

```prisma
enum BookableRoomStatus {
  ACTIVE
  OUT_OF_SERVICE
}

enum RoomPrivacyMode {
  SHOW_TITLE
  SHOW_ORGANIZER
  BUSY_ONLY
}

enum RoomCalendarProviderKey {
  LUMINA
  MICROSOFT_365
  GOOGLE_WORKSPACE
}

model BookableRoom {
  id                String                  @id @default(cuid())
  name              String
  normalizedName    String
  locationLabel     String?
  timezone          String
  capacity          Int?
  amenities         String[]                @default([])
  status            BookableRoomStatus      @default(ACTIVE)
  privacyMode       RoomPrivacyMode         @default(BUSY_ONLY)
  providerKey       RoomCalendarProviderKey @default(LUMINA)
  externalResourceId String?
  externalResourceEmail String?
  createdAt         DateTime                @default(now())
  updatedAt         DateTime                @updatedAt

  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  calendarConnectionId String?
  calendarConnection   RoomCalendarConnection? @relation(fields: [calendarConnectionId], references: [id], onDelete: SetNull)

  wayfindingPoiId String?
  wayfindingPoi   Poi? @relation(fields: [wayfindingPoiId], references: [id], onDelete: SetNull)

  reservations RoomReservation[]
  displays     RoomDisplayBinding[]

  @@unique([organizationId, normalizedName])
  @@index([organizationId, status])
  @@index([calendarConnectionId])
}
```

`wayfindingPoiId` is optional. It enables future cross-module routing when both modules are purchased but does not make Room Booking depend on Wayfinding.

The service must verify that an optional linked POI belongs to the same organization. If the tenant lacks Wayfinding, the field remains null and the Room Booking module remains fully usable.

### 7.2 `RoomDisplayBinding`

```prisma
model RoomDisplayBinding {
  id                          String   @id @default(cuid())
  quickBookingEnabled         Boolean  @default(false)
  quickBookingDurationsMinutes Int[]   @default([15, 30, 60])
  startingSoonMinutes         Int      @default(10)
  createdAt                   DateTime @default(now())
  updatedAt                   DateTime @updatedAt

  screenId String @unique
  screen   Screen @relation(fields: [screenId], references: [id], onDelete: Cascade)

  roomId String
  room   BookableRoom @relation(fields: [roomId], references: [id], onDelete: Cascade)

  @@index([roomId])
}
```

A room may drive multiple screens, but a screen may be bound to at most one room.

### 7.3 `RoomReservation`

```prisma
enum RoomReservationStatus {
  CONFIRMED
  CANCELLED
}

enum RoomReservationOrigin {
  DASHBOARD
  KIOSK
  EXTERNAL_SYNC
}

model RoomReservation {
  id                       String                @id @default(cuid())
  title                    String?
  organizerDisplayName     String?
  startsAt                 DateTime
  endsAt                   DateTime
  status                   RoomReservationStatus @default(CONFIRMED)
  providerKey              RoomCalendarProviderKey
  origin                   RoomReservationOrigin
  externalEventId          String?
  providerExternalKey      String?               @unique
  externalICalUid          String?
  externalEtag             String?
  providerUpdatedAt        DateTime?
  createdAt                DateTime              @default(now())
  updatedAt                DateTime              @updatedAt

  roomId String
  room   BookableRoom @relation(fields: [roomId], references: [id], onDelete: Cascade)

  createdByUserId String?
  createdByUser   User? @relation(fields: [createdByUserId], references: [id], onDelete: SetNull)

  @@index([roomId, startsAt, endsAt])
  @@index([roomId, providerKey])
}
```

Validate `startsAt < endsAt` in the service and database migration.

For Lumina-native confirmed reservations, enforce non-overlap at the database level using a PostgreSQL exclusion constraint over:

```sql
("roomId" WITH =, tstzrange("startsAt", "endsAt", '[)') WITH &&)
```

scoped to `status = 'CONFIRMED'` and `providerKey = 'LUMINA'`. The migration must enable `btree_gist` if the deployment does not already provide it. Use a custom Prisma migration and document the constraint because Prisma schema syntax does not represent it directly. Translate constraint violations into HTTP `409 Conflict` with the latest room availability.

Set `providerExternalKey` only for external events, using a stable connection-scoped value such as `<connectionId>:<externalEventId>`. This prevents duplicate provider projections without relying on nullable compound-unique behavior. `origin` remains `KIOSK` or `DASHBOARD` when Lumina initiated a provider-backed booking and becomes `EXTERNAL_SYNC` when the event was first observed from the provider.

External provider projections may need a documented exception if the provider legitimately returns overlaps. Do not weaken native atomic booking protection without an explicit provider reconciliation design.

Reconnect and reconciliation matching must key first on `externalICalUid` — a provider-stable event identity that survives a `RoomCalendarConnection` reconnect (a new `connectionId`) — before falling back to `providerExternalKey`. `providerExternalKey` is connection-scoped by construction (`<connectionId>:<externalEventId>`) and must not be the sole dedup key across a disconnect/reconnect cycle, or reconnecting will create duplicate projections of events already known under the old connection.

### 7.4 `RoomCalendarConnection`

Create this model when the first external connector is implemented, not during the native-only core unless a stable empty shell is useful:

```prisma
model RoomCalendarConnection {
  id                    String                  @id @default(cuid())
  providerKey           RoomCalendarProviderKey
  displayName           String
  status                String
  encryptedCredential   Bytes?
  externalTenantId      String?
  lastSuccessfulSyncAt  DateTime?
  lastErrorCode         String?
  webhookSubscriptionId String?
  webhookExpiresAt      DateTime?
  syncCursor            String?
  createdAt             DateTime                @default(now())
  updatedAt             DateTime                @updatedAt

  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  rooms BookableRoom[]

  @@index([organizationId, providerKey])
}
```

OAuth refresh tokens and client credentials must be encrypted at rest with authenticated encryption and a deployment secret outside the database. Never return them from API responses, logs, audit metadata, or health endpoints.

Disconnecting a `RoomCalendarConnection` sets `BookableRoom.calendarConnectionId` to null (`onDelete: SetNull`) for every room that referenced it. Those rooms are not deleted, reassigned, or silently converted to `LUMINA`-authoritative: they remain in their existing `status` with their existing `providerKey`, now unmapped, and require an administrator to either connect a replacement `RoomCalendarConnection` or explicitly convert the room to a native `LUMINA` room. Surface an explicit dashboard warning for any room left in this unmapped state; do not let an unmapped externally-sourced room silently start accepting native Book Now writes as if it were `LUMINA`-authoritative.

### 7.5 Migration and seed rules

- Add the new `ROOM_BOOKING` streaming enum value additively.
- Add the required inverse Prisma relations on `Organization`, `Screen`, `User`, and `Poi`.
- Existing screens stay in their current mode.
- Existing tenants receive no room rows or screen bindings automatically.
- Do not seed sample rooms in production seed paths.
- Add a development-only fixture command if an end-to-end demo requires it.
- Preserve all room data when the entitlement is disabled.

---

## 8. API Module

Create `apps/api/src/modules/room-booking/`:

```text
room-booking.module.ts
rooms.controller.ts
reservations.controller.ts
room-booking-player.controller.ts
room-booking.service.ts
room-availability.service.ts
room-player-state.service.ts
providers/room-calendar-provider.ts
providers/native-calendar.provider.ts
integrations/**
dto/**
*.spec.ts
```

All tenant dashboard controllers use normal authentication/roles plus:

```ts
@UseGuards(JwtAuthGuard, RolesGuard, EntitlementGuard)
@RequireModule('ROOM_BOOKING')
```

### 8.1 Room endpoints

```http
GET    /v1/rooms
POST   /v1/rooms
GET    /v1/rooms/:roomId
PUT    /v1/rooms/:roomId
DELETE /v1/rooms/:roomId
GET    /v1/rooms/:roomId/availability?from=&to=
```

Rules:

- every query is organization-scoped;
- room names are unique per tenant after normalization policy;
- timezone must be a supported IANA zone;
- capacity and duration settings are bounded;
- deleting a room with future reservations or active display bindings requires an explicit policy; recommended behavior is `409` until bindings are removed and future reservations are cancelled/migrated;
- external rooms are archived/disconnected rather than silently deleted when the provider mapping still exists.

### 8.2 Reservation endpoints

```http
GET    /v1/rooms/:roomId/reservations?from=&to=
POST   /v1/rooms/:roomId/reservations
PUT    /v1/rooms/:roomId/reservations/:reservationId
DELETE /v1/rooms/:roomId/reservations/:reservationId
```

Rules:

- cap query ranges and result counts;
- validate all times on the server;
- prevent native overlaps atomically;
- do not trust a client-provided availability result;
- apply provider-specific write rules for external rooms;
- use idempotency keys for create mutations;
- after a successful mutation, refresh all displays bound to the room;
- write server-side audit events.

### 8.3 Screen binding endpoints

```http
GET    /v1/room-booking/displays
PUT    /v1/room-booking/displays/:screenId
DELETE /v1/room-booking/displays/:screenId
```

Binding requirements:

- screen and room belong to the caller's organization;
- `ROOM_BOOKING` entitlement is live;
- screen mode may be configured independently, but player rendering requires both `streamingType === 'ROOM_BOOKING'` and a valid binding;
- preserve the binding when switching temporarily to another screen mode;
- reject unbounded or unsupported quick-booking durations;
- changing a binding triggers player reload when auto-publish policy says it should, while live reservation changes always refresh affected displays.

### 8.4 Player endpoints

Add a screen-authenticated mutation:

```http
POST /v1/player/room-booking/book-now
Authorization: Bearer <screen token>

{
  "durationMinutes": 30,
  "idempotencyKey": "<player-generated-uuid>"
}
```

The server derives the room from the authenticated screen binding. The request cannot specify `organizationId`, `roomId`, start time, organizer, or another screen.

Server flow:

1. validate screen token and paired screen;
2. confirm tenant active and `ROOM_BOOKING` entitlement live;
3. confirm screen mode and binding;
4. confirm room active and quick booking enabled;
5. confirm duration is an approved preset;
6. set `startsAt` from the server clock;
7. cap `endsAt` before the next confirmed reservation;
8. reject when the resulting interval is below the minimum duration;
9. create atomically through the room's provider;
10. return the normalized booking and refreshed player payload;
11. fan out reload/publish to every display bound to the room.

Apply a tight per-screen throttle and idempotency storage so repeated taps or network retries do not create duplicates.

---

## 9. Player-State Integration

### 9.1 Screen mode

Extend:

- Prisma `StreamingType`;
- `SetStreamingTypeDto`;
- dashboard local/shared screen types;
- screen mode selector;
- player `StreamingType`; and
- all exhaustive mode switches.

`ScreensService.setStreamingType()` must call:

```ts
await entitlements.assertModule(orgId, 'ROOM_BOOKING');
```

when the requested mode is `ROOM_BOOKING`.

### 9.2 State assembly

Add a shared top-level field:

```ts
roomBooking: RoomBookingPlayerPayload | null;
```

Compute once per state request:

```ts
const roomBookingConfigured =
  screen.streamingType === 'ROOM_BOOKING' && !!screen.roomDisplayBinding;

const roomBookingEntitled = roomBookingConfigured
  ? await entitlements.hasModule(orgId, 'ROOM_BOOKING')
  : false;
```

- Build the payload only when configured and entitled.
- Issue a `ROOM_BOOKING` lease only when genuinely entitled and a protected payload is returned.
- Do not issue a lease for suspended tenants.
- No Room Booking business-rule bypass exists.
- Preserve emergency playlist priority above Room Booking.
- Return Lumina's neutral unavailable state when the mode is selected but entitlement/binding is missing.
- Log an operational reason when configured but not renderable.

### 9.3 Bounded schedule window

The normal player payload should contain:

- any reservation already in progress;
- reservations from `serverNow` through the end of the room's local day; and
- enough next-day data to show the first upcoming reservation when today has ended.

Cap the total count. Refresh on WebSocket notification and on a short scheduled interval so status transitions occur even if no booking mutation is received.

---

## 10. Player UI

Add:

```text
apps/player/src/components/RoomBookingView.tsx
apps/player/src/components/RoomBookingTimeline.tsx
apps/player/src/components/RoomQuickBookingDialog.tsx
apps/player/src/lib/roomBookingState.ts
apps/player/src/lib/roomBookingClient.ts
```

### 10.1 Render order

Preserve the existing high-priority branches:

1. power/stopped behavior according to current player policy;
2. emergency playlist;
3. Wayfinding evacuation when applicable;
4. Room Booking when mode, payload, and valid lease are present;
5. ordinary Wayfinding;
6. asset/playlist content;
7. neutral unavailable state.

Do not let Room Booking cover an active emergency playlist.

### 10.2 Status resolver

Create a pure function that receives `serverNow`, reservations, starting-soon threshold, and room status, then returns:

```ts
type RoomDisplayState =
  | { kind: 'AVAILABLE'; availableUntil: string | null }
  | { kind: 'STARTING_SOON'; nextReservation: DisplayReservation }
  | { kind: 'OCCUPIED'; currentReservation: DisplayReservation }
  | { kind: 'OUT_OF_SERVICE' }
  | { kind: 'STALE'; lastGeneratedAt: string };
```

Use a server-time offset captured from the latest payload rather than trusting the raw device clock for transition accuracy. Recompute locally every minute between network refreshes.

### 10.3 Offline behavior

- A valid module lease may display cached room state.
- The UI must clearly mark data stale when the API refresh fails past the configured freshness threshold.
- Disable Book Now whenever connectivity is not confirmed.
- Do not queue an offline reservation for later submission.
- After module lease expiry, stop Room Booking rendering and show the existing neutral state.
- Keep cached state so successful revalidation can restore immediately.
- Never show a cached room as certainly available after its data freshness window has passed; use `STALE` rather than green availability.

### 10.4 Accessibility and localization

- complete English and Arabic UI;
- RTL-safe layout;
- large touch targets;
- color plus text/icon status, never color alone;
- sufficient contrast and readable hallway distance;
- no small scrolling-only critical information;
- localized time formatting in the room timezone;
- screen-reader labels where the kiosk platform exposes them.

---

## 11. Dashboard Work

### 11.1 Navigation and route protection

- Add a `Room Booking` navigation item inside the existing shell.
- Hide it until capabilities load and `hasModule('ROOM_BOOKING')` passes.
- Guard `/room-booking` with `useModuleRouteGuard('ROOM_BOOKING')` before any queries.
- Direct URL access by an unentitled tenant must start no Room Booking requests.

### 11.2 Room inventory

Support:

- create/edit/archive or safe delete;
- name, location label, timezone, capacity, amenities;
- privacy mode;
- active/out-of-service state;
- provider/source status;
- optional Wayfinding POI link shown only when both modules are available.

### 11.3 Calendar

Provide day view first; add week view only after the day workflow is stable.

- current-time indicator;
- conflict-aware create/edit for native rooms;
- clear room timezone;
- privacy-safe display in shared administration contexts;
- provider badge and read-only state where connector policy forbids editing;
- no reuse of the signage scheduling UI.

### 11.4 Displays

- list paired screens and current modes;
- bind a screen to a room;
- select `ROOM_BOOKING` mode;
- enable/disable Book Now;
- configure approved durations and starting-soon threshold;
- preview each privacy/status mode;
- preserve bindings across mode changes;
- show a precise configuration warning if a room screen has no binding.

### 11.5 Internationalization

Add complete `en.json` and `ar.json` keys for all room statuses, privacy modes, calendar actions, connector states, validation errors, stale/offline behavior, and kiosk interactions.

---

## 12. Entitlement and Refresh Enforcement

| Layer | Requirement |
| --- | --- |
| Navigation | Hide Room Booking when unavailable. |
| Dashboard route | Guard before queries. |
| Dashboard API | `@RequireModule('ROOM_BOOKING')`. |
| Screen mode | Reject `ROOM_BOOKING` mode without entitlement. |
| Room/display config | Reject writes without entitlement; keep stored rows when disabled. |
| Player state | Omit payload and lease when unavailable. |
| Player mutation | Revalidate entitlement live on every Book Now call. |
| Cached player | Enforce `ROOM_BOOKING` module lease and stale-data rules. |

Generalize `PlatformTenantsService.setModules()` so a `ROOM_BOOKING` entitlement change reloads all screens currently in `ROOM_BOOKING` mode. Reuse `ScreenGateway.sendToScreen()` fan-out.

Reservation changes must refresh every screen bound to the affected room regardless of `autoPublish`; availability is live operational data, like Wayfinding POI status, not draft content.

---

## 13. External Calendar Connector Architecture

This section is implemented only when its connector milestone is selected.

### 13.1 Microsoft 365

Capabilities:

- discover/map Microsoft room resources;
- read availability with Microsoft Graph schedule/calendar APIs;
- create room calendar events with the least required permission;
- normalize provider event IDs, iCal UIDs, etags, timezone, cancellation, and recurrence instances;
- subscribe to event changes;
- renew expiring subscriptions;
- run periodic reconciliation in case notifications are delayed or missed.

Do not confuse Microsoft Bookings customer-appointment APIs with Exchange room-resource calendars. The Room Booking Signage connector targets room calendars/resources.

### 13.2 Google Workspace

Capabilities:

- map a bookable room to its resource calendar;
- query free/busy;
- list and create events;
- use incremental sync tokens;
- receive push notifications;
- renew notification channels;
- fall back to periodic reconciliation.

### 13.3 Webhook rules

- public HTTPS callback endpoint;
- validate provider authenticity/client state;
- acknowledge quickly and enqueue reconciliation in BullMQ;
- make processing idempotent;
- never perform slow full synchronization inside the webhook request;
- handle duplicate, reordered, and missing notifications;
- renew subscriptions/channels before expiry;
- record health without secret or event-body leakage;
- refresh bound screens only after the normalized projection changes.

### 13.4 Connection security

- least-privilege OAuth/application permissions;
- encrypted refresh tokens/credentials;
- redacted logs;
- explicit disconnect that revokes provider access where supported;
- tenant-scoped connection and room mapping;
- CSRF/state validation during OAuth;
- no provider token in dashboard local storage;
- no connector endpoint callable with a screen token;
- auditable connect, disconnect, room-map, and permission changes.

---

## 14. Audit and Operational Observability

Use `AuditService.log()` for:

```text
room.create
room.update
room.status.update
room.delete
room.display.bind
room.display.unbind
room.reservation.create
room.reservation.update
room.reservation.cancel
room.integration.connect
room.integration.disconnect
room.integration.map
```

For Book Now, record origin `KIOSK`, screen ID, room ID, duration, and result, but no visitor identity.

Operational metrics should include:

- reservation create success/conflict/failure;
- player payload age;
- rooms with stale provider sync;
- webhook processing lag;
- subscription renewal failures;
- provider rate limits;
- connector health by tenant without exposing secrets.

Historical normalized `RoomReservation` and connection-health records are deleted after a configurable retention window (`ROOM_BOOKING_RECORD_RETENTION_DAYS`, environment-configured), enforced by a scheduled cleanup job — the same operational-control pattern as `PLAYER_ENTITLEMENT_OFFLINE_GRACE_HOURS`. `RoomCalendarConnection.encryptedCredential` is deleted immediately on disconnect regardless of this window. The retention duration is a pending product/legal decision, not invented by this plan, and must be set before production use.

The current dashboard audit log remains client-mocked; do not mistake it for the server audit trail. Room Booking mutations must write to the existing server `AuditService` even if a full server-backed audit-log UI remains separate work.

---

## 15. Testing Strategy

### 15.1 API unit tests

Cover:

- room and reservation tenant isolation;
- unentitled, expired, disabled, and suspended tenants;
- role enforcement;
- room timezone validation;
- half-open interval behavior and back-to-back reservations;
- concurrent native booking conflict with exactly one winner;
- idempotent duplicate Book Now request;
- server-clock start time;
- next-reservation duration cap;
- privacy redaction before player response;
- external connection secrets never serialized;
- display binding ownership and uniqueness;
- data preserved across entitlement disable/re-enable;
- player payload/lease only when configured and entitled;
- module change refresh fan-out;
- reservation change refresh to every bound screen.

### 15.2 Pure time/state tests

Commit deterministic tests for:

- available, starting soon, occupied, out of service, and stale;
- midnight and local-day boundaries;
- daylight-saving transitions in representative zones;
- server-time offset behavior;
- current meeting ending exactly when the next begins;
- cached freshness threshold;
- module lease expiry.

### 15.3 Player tests

Cover:

- every visual status;
- privacy modes;
- Book Now enabled/disabled;
- offline/stale disables booking;
- retry does not duplicate a booking;
- emergency playlist overrides Room Booking;
- missing binding or entitlement shows neutral state;
- WebSocket refresh updates status without a full device re-pair;
- English/Arabic and RTL rendering.

Add a committed player test command following the existing script-based test pattern if a general runner is not introduced.

### 15.4 Connector contract tests

Every provider adapter must pass the same contract suite against recorded/synthetic provider responses:

- normalization;
- recurrence expansion;
- cancellations;
- timezone handling;
- private events;
- rate limits/retry-after;
- expired credentials;
- duplicate webhooks;
- missed webhook reconciliation;
- idempotent create recovery.

Live provider tests use dedicated sandbox/test tenants and must never run in the normal unit suite.

### 15.5 End-to-end core acceptance

1. Create Tenant A with `ROOM_BOOKING`; create Tenant B without it.
2. Confirm Tenant B has no navigation, direct route access, API access, screen mode, payload, or player booking action.
3. Create two rooms for Tenant A in different timezones or locations.
4. Create a native reservation and confirm conflict rejection.
5. Bind one paired screen and select `ROOM_BOOKING` mode.
6. Confirm available/starting-soon/occupied transitions from server-derived time.
7. Confirm the configured privacy mode redacts data in the API payload itself.
8. Use Book Now and confirm the dashboard and every bound display refresh.
9. Disconnect the player; confirm stale state and disabled booking.
10. Expire the module lease; confirm the neutral state.
11. Reconnect; confirm immediate recovery.
12. Disable `ROOM_BOOKING`; confirm neutral player state and all rows preserved.
13. Re-enable it; confirm the same room, reservations, binding, and settings return.
14. Activate an emergency playlist; confirm it overrides the room display.

### 15.6 Connector acceptance

For each selected provider:

1. connect a test organization;
2. map a provider room resource;
3. import current/future events;
4. create an event from the dashboard;
5. create Book Now from the room screen;
6. create/update/cancel externally and confirm webhook synchronization;
7. simulate a missed webhook and confirm scheduled reconciliation;
8. expire/revoke credentials and confirm safe health state;
9. reconnect without duplicating reservations;
10. disconnect and confirm secrets are removed/revoked while historical normalized records follow the retention policy.

---

## 16. Milestones

### Milestone RB0 — Entry gate and Room Booking ADR

- [ ] Confirm all three plans exist in repository planning-baseline commit P and were re-reviewed through planning handoff commit Q.
- [ ] Confirm the shared preflight entry gate is complete.
- [ ] Confirm AI Wayfinding is merged and its full verification gate passed.
- [ ] Confirm verified AI implementation commit C is recorded in this plan.
- [ ] Record docs-only handoff commit D's full hash in the Room Booking execution/PR log.
- [ ] Confirm this branch starts from exact commit D on verified post-AI `main`.
- [ ] Freeze native-core versus connector release profile.
- [ ] Freeze privacy defaults and kiosk action scope.
- [ ] Freeze interval, conflict, timezone, and deletion policies.
- [ ] Record the Room Booking ADR.

### Milestone RB1 — Shared contracts and database

- [ ] Add Room Booking types and schemas.
- [ ] Add `ROOM_BOOKING` streaming mode.
- [ ] Add room, reservation, and display-binding models.
- [ ] Add PostgreSQL non-overlap protection for native reservations.
- [ ] Add migration and database tests.

### Milestone RB2 — Core API

- [ ] Add room CRUD and availability.
- [ ] Add native reservation CRUD.
- [ ] Add display binding and settings.
- [ ] Add org/role/module enforcement.
- [ ] Add audit events and refresh fan-out.
- [ ] Add atomic/idempotent Book Now.

### Milestone RB3 — Dashboard

- [ ] Add module-gated navigation and route.
- [ ] Add room inventory.
- [ ] Add day calendar and reservation flow.
- [ ] Add display binding/configuration.
- [ ] Add privacy/status preview.
- [ ] Add English/Arabic translations.

### Milestone RB4 — Player

- [ ] Add bounded room payload and module lease.
- [ ] Add status resolver and room display UI.
- [ ] Add Book Now flow.
- [ ] Add stale/offline behavior.
- [ ] Preserve emergency priority.
- [ ] Add committed player tests.

### Milestone RB5 — Core verification and release

- [ ] Run API, dashboard, player, typecheck, lint, and tests.
- [ ] Run the core end-to-end acceptance scenario.
- [ ] Verify concurrent conflict behavior.
- [ ] Verify disable/re-enable data preservation.
- [ ] Document operations, backup, rollback, and known limitations.
- [ ] Tag the core module release.

### Milestone RB6 — Microsoft 365 connector (optional/contract-driven)

- [ ] Add secure connection flow and room discovery/mapping.
- [ ] Add read/create provider operations.
- [ ] Add notifications, renewal, and reconciliation.
- [ ] Add health UI and provider contract tests.
- [ ] Run connector acceptance and document required permissions.

### Milestone RB7 — Google Workspace connector (optional/contract-driven)

- [ ] Add secure connection flow and resource-calendar mapping.
- [ ] Add free/busy, event read/create, and incremental sync.
- [ ] Add notification channels, renewal, and reconciliation.
- [ ] Add health UI and provider contract tests.
- [ ] Run connector acceptance and document required scopes.

---

## 17. Expected File Changes

New domain files:

```text
packages/types/src/room-booking.ts
apps/api/src/modules/room-booking/**
apps/dashboard/src/app/[locale]/(app)/room-booking/page.tsx
apps/dashboard/src/components/room-booking/**
apps/player/src/components/RoomBookingView.tsx
apps/player/src/components/RoomBookingTimeline.tsx
apps/player/src/components/RoomQuickBookingDialog.tsx
apps/player/src/lib/roomBookingState.ts
apps/player/src/lib/roomBookingClient.ts
docs/adr/room-booking-module.md
```

Expected shared-file edits:

```text
packages/types/src/index.ts
apps/api/prisma/schema.prisma
apps/api/src/app.module.ts
apps/api/src/config/env.validation.ts
apps/api/src/modules/screens/dto/set-streaming-type.dto.ts
apps/api/src/modules/screens/screens.service.ts
apps/api/src/modules/player/player.service.ts
apps/api/src/modules/platform-tenants/platform-tenants.service.ts
apps/dashboard/src/app/[locale]/(app)/layout.tsx
apps/dashboard/src/app/[locale]/(app)/screens/page.tsx
apps/dashboard/src/lib/api.ts
apps/dashboard/messages/en.json
apps/dashboard/messages/ar.json
apps/player/src/lib/api.ts
apps/player/src/pages/PlayerPage.tsx
```

Connector milestones also add worker processors/jobs and public webhook controllers.

---

## 18. Integration and Optional Parallel Work Contract

- All three plans are repository artifacts before preflight or feature implementation begins.
- `modules_shared_preflight_plan.md` is complete through its tagged handoff commit before either feature module starts.
- By default, Room Booking starts only after AI Wayfinding implementation commit C is merged and verified and docs-only handoff commit D records C in both plans.
- The Room Booking branch starts from D; D's full hash is recorded outside D in the Room Booking execution/PR log.
- The Room Booking branch owns `room-booking/**` and Room Booking-specific components.
- The AI Wayfinding branch must not import Room Booking services or tables.
- Optional linking uses only `BookableRoom.wayfindingPoiId`; it must not make room creation depend on Wayfinding.
- If parallel execution is explicitly re-enabled, both branches may create independent migrations, but one integration owner resolves `schema.prisma`, generated Prisma client, and migration order.
- If parallel execution is explicitly re-approved before AI completion, replace the sequential C/D entry gate with the exact `modules-shared-preflight-v1` tag target used by the AI branch, record that decision and hash in the Room Booking execution/PR log, and do not pretend the post-AI baseline was used.
- Only the integration owner merges shared wiring in `app.module.ts`, navigation, translation roots, `PlayerService`, `PlayerPage`, `ScreensService`, and `PlatformTenantsService`.
- Keep feature-domain commits separate from shared-wiring commits.
- After the second module is wired, rerun all API tests plus both player acceptance paths; passing each branch alone is insufficient.

### 18.1 Future optional cross-module contract

After both modules ship independently, a later milestone may let AI Wayfinding answer queries such as "Where is Meeting Room A?" by treating a room with `wayfindingPoiId` as a normal verified destination.

A still later feature may search room availability, but only if:

- both `WAYFINDING_AI` and `ROOM_BOOKING` are entitled;
- an explicit read-only cross-module service contract exists;
- privacy rules prevent meeting detail leakage; and
- the AI still returns a verified room/POI while deterministic routing remains local.

Do not implement availability search in either initial module plan.

---

## 19. Definition of Done

The Room Booking core is complete when:

- it is independently assignable, trialable, disableable, and auditable as `ROOM_BOOKING`;
- a tenant can create and manage rooms and native reservations without Wayfinding;
- native booking conflicts are prevented atomically;
- a paired Lumina screen can be bound to one room and run in `ROOM_BOOKING` mode;
- the hallway display accurately shows available, starting soon, occupied, out-of-service, and stale states;
- privacy redaction occurs on the server;
- Book Now is policy-controlled, server-clocked, bounded, online-only, idempotent, and conflict-safe;
- every live reservation change refreshes all bound displays;
- offline cached display obeys freshness and module-lease rules;
- emergency content retains higher priority;
- disabling/re-enabling preserves all rooms, reservations, bindings, and settings;
- API, dashboard, player, database, and end-to-end gates pass; and
- connector support is advertised only after the corresponding connector milestone passes.

---

## 20. Non-Goals for the Core Release

Do not add these while implementing RB0-RB5:

- employee directory or SSO kiosk login;
- attendee invitation workflows;
- check-in and automatic no-show release;
- anonymous cancel, extend, or end-early actions;
- catering, equipment, desk, or parking booking;
- occupancy sensors;
- payment or paid reservations;
- AI room recommendations;
- voice booking;
- full recurring-series authoring in Lumina;
- Wayfinding as a required dependency;
- a second dashboard, player, authentication system, or entitlement mechanism;
- Microsoft 365 or Google Workspace code before that connector milestone is explicitly selected.

---

## 21. External Technical References

Microsoft 365 connector:

- Room resource: `https://learn.microsoft.com/en-us/graph/api/resources/room?view=graph-rest-1.0`
- Free/busy schedule: `https://learn.microsoft.com/en-us/graph/api/calendar-getschedule?view=graph-rest-1.0`
- Create event: `https://learn.microsoft.com/en-us/graph/api/calendar-post-events?view=graph-rest-1.0`
- Change notifications: `https://learn.microsoft.com/en-us/graph/change-notifications-overview`

Google Workspace connector:

- Free/busy query: `https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query`
- Create event: `https://developers.google.com/workspace/calendar/api/v3/reference/events/insert`
- Incremental synchronization: `https://developers.google.com/workspace/calendar/api/guides/sync`
- Push notifications: `https://developers.google.com/workspace/calendar/api/guides/push`

These references define provider capabilities, not Lumina's domain. The normalized Room Booking contracts, entitlement rules, privacy policy, and player behavior in this plan remain authoritative.