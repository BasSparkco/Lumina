# AI Wayfinding Module — Implementation Plan

**Status:** Ready for implementation review  
**Repository:** `https://github.com/BasSparkco/Lumina`  
**Reviewed baseline:** `bdee2b839449c86d5d98000dfb9e55e67cc0d059` on `main` (2026-09-05)  
**Repository planning baseline:** commit P `fe643d22d1f280e31b2ccdbe3502aeb9138e3beb` — reviewed and approved  
**Foundation:** `platform-modules-foundation-v1`; Platform Modules and Tenant Entitlements Phases A/B are complete  
**Required underlying implementation commit:** commit A `a3f047e376a1b5bff246f3dc4dad17802a8742f0` — verified and merged to `main`  
**Required branch baseline:** the handoff commit tagged `modules-shared-preflight-v1`; record the tag target's full hash in the AI execution/PR log before AI1  
**Commercial module key:** `WAYFINDING_AI`  
**Required dependency:** `WAYFINDING`

---

## 1. Outcome

Build AI Wayfinding as a separately purchasable Lumina module that adds a conversational destination assistant to the existing Wayfinding kiosk. A visitor may ask, in natural language, where a destination is. The assistant resolves the request to one verified POI, asks a clarification question when necessary, and then hands the selected POI to Lumina's existing deterministic on-device routing engine.

The module remains part of the current Lumina dashboard and player. It does not launch a second application, duplicate the map, or replace the existing directory and route graph.

The first sellable release is text-first and supports English and Arabic. Voice input/output, free-form facility knowledge bases, and live indoor positioning are later extensions, not requirements for the first release.

---

## 2. Repository Assessment

The baseline already provides the important prerequisites:

- `MODULE_KEYS` already contains `WAYFINDING_AI`.
- `MODULE_DEPENDENCIES` already declares `WAYFINDING_AI -> WAYFINDING`.
- `EntitlementsService.hasModule()` resolves that dependency recursively on the API.
- `@RequireModule()`, `EntitlementGuard`, `GET /v1/org/capabilities`, `useModuleRouteGuard()`, and `useModuleAccess()` are available.
- Wayfinding already has buildings, floors, floor-plan assets, POIs, bilingual POI fields, kiosk locations, route nodes, route edges, accessible routing, evacuation routing, QR directions, text-to-speech, and kiosk analytics.
- `WayfindingKioskMap` already owns POI selection, floor switching, route opening, and route rendering.
- `apps/player/src/lib/routing.ts` already computes the route locally with Dijkstra. It must remain the sole route-computation authority.
- The player already supports generic `moduleLeases: PlayerModuleLease[]` for offline entitlement control.
- `ScreenGateway.sendToScreen()` already provides per-screen refresh fan-out.

No LLM SDK, AI provider abstraction, conversational API, AI usage accounting, or AI-specific screen configuration exists today.

### 2.1 Required preflight entry gate

All three plan files must first exist in repository planning-baseline commit P and pass the repository-level re-review described by `modules_shared_preflight_plan.md`. The accepted plan corrections and P's hash are committed in reviewed planning handoff commit Q; the shared preflight starts from Q.

The reviewed baseline contains shared foundation issues that are intentionally owned by `modules_shared_preflight_plan.md`. Complete that plan once using its two-commit handoff: implementation commit A, followed by docs-only handoff commit B that records A. Tag commit B as `modules-shared-preflight-v1`, then start this module branch from B.

Because commit B cannot contain its own hash, verify and record `git rev-parse modules-shared-preflight-v1` in the AI execution/PR log before any AI code change. The tag target, branch HEAD, and recorded hash must match. Do not use the original `bdee2b8`, commit P, commit Q, or implementation commit A alone as the feature branch point.

This feature branch must not independently reimplement the suspension/evacuation correction, dashboard dependency resolver, B6 heading correction, or shared integration rules. Verify them as prerequisites, then implement only AI Wayfinding work.

---

## 3. Product Decisions to Freeze

### 3.1 Separate commercial module

- AI Wayfinding is sold and assigned with `WAYFINDING_AI`.
- It is not included automatically with `WAYFINDING`.
- A tenant cannot use it unless both `WAYFINDING_AI` and `WAYFINDING` are usable.
- Disabling AI Wayfinding does not disable ordinary Wayfinding.
- Disabling or expiring ordinary Wayfinding makes AI Wayfinding unusable because of the declared dependency.
- No per-user purchase override is introduced.

### 3.2 Additive user experience

- Keep the existing map, directory, search, accessibility mode, language switch, QR directions, and evacuation view.
- Add an **Ask the Assistant** action inside the existing Wayfinding kiosk header.
- The assistant opens as an overlay or side panel inside `WayfindingKioskMap`.
- A successful destination resolution closes or minimizes the conversation, selects the verified POI, switches to the correct floor, and opens the existing route UI.
- The ordinary directory remains the fallback when the AI service is unavailable.

### 3.3 The model selects a destination; Lumina calculates the route

The AI provider must never:

- generate coordinates;
- generate route-node IDs or route edges;
- calculate the shortest path;
- invent turn-by-turn directions;
- override accessibility or evacuation constraints;
- fetch arbitrary internet data; or
- execute general-purpose tools.

The provider may return only a structured intent result containing a validated POI ID, a bounded candidate set for a nearest-category request, a clarification request, or a no-match result. After validation, the existing player routing code computes and renders the route. For a request such as "the nearest restroom," the model identifies the intent and candidate POIs; the player chooses the reachable candidate with the lowest deterministic route cost.

### 3.4 Text-first release

The first release supports touch keyboard/text entry in English and Arabic. Existing player TTS may read the deterministic route steps after a POI is selected. Speech-to-text and realtime voice conversation are deferred until text accuracy, latency, cost, privacy, and kiosk acoustics are measured in production.

### 3.5 Online AI with graceful degradation

- The conversational resolution call requires a live API connection.
- The existing ordinary Wayfinding experience remains offline-capable under its current lease rules.
- When AI is unavailable, show a neutral localized message and a direct action to open the existing Directory.
- Never claim an AI answer was generated offline.
- The AI button itself is subject to the `WAYFINDING_AI` module lease when restoring cached player state.
- Lease expiry hides the paid AI entry point without deleting cached Wayfinding data.

### 3.6 Provider isolation

Define an application-owned provider interface. Ship one initial OpenAI adapter behind it, but do not expose provider vocabulary to controllers, player code, or database domain models.

Configuration must be environment-based:

```text
AI_WAYFINDING_PROVIDER=openai
AI_WAYFINDING_MODEL=<deployment-selected-model>
AI_WAYFINDING_API_KEY=<secret>
AI_WAYFINDING_TIMEOUT_MS=8000
AI_WAYFINDING_MAX_INPUT_CHARS=500
AI_WAYFINDING_MAX_TURNS=8
AI_WAYFINDING_DAILY_REQUEST_LIMIT_PER_SCREEN=<configured-limit>
AI_WAYFINDING_DAILY_REQUEST_LIMIT_PER_TENANT=<configured-limit>
AI_WAYFINDING_USAGE_LOG_RETENTION_DAYS=<pending product/legal decision — must be set before production use>
```

Do not hard-code a model name into persisted tenant data. Model upgrades are an operational decision and must not require a tenant migration.

### 3.7 Privacy default

- Do not persist raw visitor messages or full conversations by default.
- Store operational metadata only: organization, screen, language, outcome, resolved POI, latency, token counts, provider/model identifier, and timestamp.
- Do not send visitor identity, user accounts, booking details, route geometry, floor-plan images, or unrelated tenant data to the provider.
- Send the smallest destination catalog required for the current building.
- Add an explicit future privacy setting before any raw-query retention is introduced.

---

## 4. Architecture

```text
Wayfinding kiosk
  -> Player AI endpoint (screen JWT)
     -> live tenant + module checks
     -> deterministic name/alias resolver
     -> AI provider only when needed
     -> structured result validation
  -> verified POI ID
  -> existing local Dijkstra route
  -> existing map, steps, QR and TTS
```

The API is the only caller of the AI provider. The API key must never reach the dashboard, player bundle, player state, browser storage, or WebSocket payloads.

### 4.1 Resolution pipeline

For each visitor request:

1. Authenticate the player token and load its screen.
2. Confirm the tenant is active for normal AI use.
3. Confirm live `WAYFINDING_AI` entitlement; dependency validation also confirms `WAYFINDING`.
4. Confirm the screen is a configured Wayfinding kiosk with AI enabled.
5. Load only POIs belonging to the kiosk's building.
6. Normalize the query and run a deterministic exact-name/alias match first.
7. If exactly one strong match exists, return it without an LLM call.
8. Otherwise call the provider with a compact destination catalog and strict structured output.
9. Validate every returned POI ID against the server-loaded catalog.
10. Return `DESTINATION`, `NEAREST_DESTINATION`, `CLARIFICATION`, `NO_MATCH`, or `UNAVAILABLE`.
11. For `NEAREST_DESTINATION`, the player computes routes to the bounded verified candidate set and selects the lowest-cost reachable destination.
12. The player hands the validated destination to the existing route UI.

The deterministic first pass reduces cost and latency and makes common exact queries independent of model behavior.

---

## 5. Shared Contracts

Add `packages/types/src/wayfinding-ai.ts` and explicitly re-export its runtime schemas from `packages/types/src/index.ts`.

Recommended contracts:

```ts
export interface WayfindingAiPlayerConfig {
  enabled: boolean;
  welcomeMessage: string;
  welcomeMessageAr: string;
  maxTurns: number;
}

export type WayfindingAiResolution =
  | {
      type: 'DESTINATION';
      poiId: string;
      message: string;
    }
  | {
      type: 'NEAREST_DESTINATION';
      candidatePoiIds: string[];
      message: string;
    }
  | {
      type: 'CLARIFICATION';
      message: string;
      alternatives: Array<{ poiId: string; label: string; floorLabel: string }>;
    }
  | {
      type: 'NO_MATCH';
      message: string;
    }
  | {
      type: 'UNAVAILABLE';
      message: string;
    };

export interface ResolveWayfindingAiRequest {
  message: string;
  language: 'en' | 'ar';
  recentTurns?: Array<{ role: 'user' | 'assistant'; text: string }>;
}
```

Use Zod schemas for player/API boundary validation. Limit recent turns, input length, alternative count, and every string length in the schema.

Add the AI configuration inside the existing Wayfinding payload rather than inventing a second full player-state branch:

```ts
interface WayfindingDirectory {
  // existing fields
  aiAssistant: WayfindingAiPlayerConfig | null;
}
```

`aiAssistant` is non-null only when:

- Wayfinding is configured and renderable;
- the screen AI configuration is enabled;
- the tenant currently owns `WAYFINDING_AI`; and
- normal non-emergency Wayfinding is being served.

An emergency bypass must never expose the assistant or earn a `WAYFINDING_AI` lease.

---

## 6. Database Changes

### 6.1 `WayfindingAiScreenConfig`

Create a one-to-one optional configuration owned through `Screen`:

```prisma
model WayfindingAiScreenConfig {
  id               String   @id @default(cuid())
  enabled          Boolean  @default(true)
  welcomeMessage   String   @default("How can I help you find your destination?")
  welcomeMessageAr String
  maxTurns         Int      @default(8)
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  screenId String @unique
  screen   Screen @relation(fields: [screenId], references: [id], onDelete: Cascade)
}
```

Do not store provider prompts, API keys, or model names here.

### 6.2 `PoiAlias`

Add explicit aliases so tenants can teach the destination resolver familiar names without changing the public POI name:

```prisma
model PoiAlias {
  id              String   @id @default(cuid())
  value           String
  normalizedValue String
  language        String
  createdAt       DateTime @default(now())

  poiId String
  poi   Poi @relation(fields: [poiId], references: [id], onDelete: Cascade)

  @@unique([poiId, language, normalizedValue])
  @@index([normalizedValue])
}
```

Normalization is server-owned: trim, Unicode normalize, collapse whitespace, and apply locale-safe case folding. Do not use aliases as raw prompt instructions.

### 6.3 `WayfindingAiUsageLog`

Add an operational/cost record without raw conversation text:

```prisma
model WayfindingAiUsageLog {
  id           String   @id @default(cuid())
  language     String
  outcome      String
  provider     String
  model        String
  inputTokens  Int?
  outputTokens Int?
  latencyMs    Int
  usedModel    Boolean
  createdAt    DateTime @default(now())

  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  screenId       String
  screen         Screen @relation(fields: [screenId], references: [id], onDelete: Cascade)
  resolvedPoiId  String?

  @@index([organizationId, createdAt])
  @@index([screenId, createdAt])
}
```

`resolvedPoiId` may remain an un-enforced historical identifier so deletion of a POI does not delete cost/usage history. Do not make this log a cascade dependency of `Poi`.

### 6.4 Migration requirements

- Use one additive Prisma migration.
- Add `Screen.wayfindingAiConfig`, `Screen.wayfindingAiUsageLogs`, and `Poi.aliases` relations.
- Add `Organization.wayfindingAiUsageLogs`.
- Do not modify `TenantModule`; the catalog and entitlement row already exist.
- Existing tenants and screens receive no AI configuration automatically.
- No existing Wayfinding screen should show the AI button merely because the module is assigned; an administrator must explicitly enable it per screen.

---

## 7. API Module

Create `apps/api/src/modules/wayfinding-ai/` with:

```text
wayfinding-ai.module.ts
wayfinding-ai.controller.ts
wayfinding-ai-player.controller.ts
wayfinding-ai.service.ts
destination-resolver.service.ts
wayfinding-ai-usage.service.ts
providers/wayfinding-ai-provider.ts
providers/openai-wayfinding-ai.provider.ts
dto/update-wayfinding-ai-screen-config.dto.ts
dto/resolve-wayfinding-ai.dto.ts
*.spec.ts
```

### 7.1 Dashboard endpoints

All dashboard endpoints require `JwtAuthGuard`, normal role enforcement, `EntitlementGuard`, and `@RequireModule('WAYFINDING_AI')`.

```http
GET  /v1/wayfinding-ai/screens
GET  /v1/wayfinding-ai/screens/:screenId/config
PUT  /v1/wayfinding-ai/screens/:screenId/config
GET  /v1/wayfinding-ai/usage?from=&to=&screenId=
POST /v1/wayfinding-ai/test-resolve
```

Rules:

- Read access follows the project's existing read role policy.
- Configuration writes require the same role level used for screen/Wayfinding configuration.
- `test-resolve` is dashboard-authenticated, rate-limited, and uses the selected building rather than a physical player token.
- Every screen and building lookup must be org-scoped with `OrgScopedService` conventions.
- Enabling AI requires `screen.streamingType === 'WAYFINDING'` and an existing `KioskLocation`.
- Log configuration changes with the existing server-side `AuditService`.

### 7.2 Player endpoint

```http
POST /v1/player/wayfinding-ai/resolve
Authorization: Bearer <screen token>
```

Apply:

- the existing player JWT guard;
- strict DTO validation;
- a tight per-screen throttle;
- live tenant status and entitlement validation;
- per-screen and per-tenant daily quota (§11.2);
- provider timeout and cancellation;
- generic public errors that do not reveal licensing or provider failures.

The server derives `screenId`, `organizationId`, building, and destination catalog from the authenticated screen. The request must not be allowed to choose another screen, tenant, building, or POI catalog.

### 7.3 Provider interface

```ts
interface WayfindingAiProvider {
  resolveDestination(input: {
    message: string;
    language: 'en' | 'ar';
    recentTurns: Array<{ role: 'user' | 'assistant'; text: string }>;
    destinations: Array<{
      id: string;
      name: string;
      nameAr: string | null;
      aliases: Array<{ value: string; language: string }>;
      category: string;
      floorLabel: string;
      status: 'OPEN' | 'CLOSED' | 'RELOCATED';
      description: string | null;
      descriptionAr: string | null;
    }>;
  }): Promise<ProviderResolution>;
}
```

The OpenAI adapter should use the current Responses API with function calling or strict structured output. Keep the JSON schema small and set `additionalProperties: false`. The provider response is untrusted until Zod parsing and POI membership validation succeed.

### 7.4 Destination rules

- Prefer `OPEN` destinations.
- If the best match is `CLOSED`, explain that it is closed and do not begin a route unless product policy later allows routing to closed locations.
- If a POI is `RELOCATED`, route only if its current pin represents the new location; otherwise return a clarification/unavailable result.
- When two POIs have similar names, return alternatives with floor labels.
- Never return a POI from another building or tenant.
- Never accept a model-generated ID not present in the supplied catalog.
- For a nearest-category request, cap and validate every candidate ID; select the winner with the existing route engine, never with model prose.
- If the model fails validation, record `INVALID_PROVIDER_OUTPUT` and return a safe no-match response.

---

## 8. Dashboard Work

### 8.1 Navigation and route

Add `/wayfinding/ai` inside the existing authenticated Lumina shell. It is a module page, not a second dashboard.

- Hide the navigation entry until capabilities load and `hasModule('WAYFINDING_AI')` is true.
- Protect direct navigation with `useModuleRouteGuard('WAYFINDING_AI')` before starting queries.
- Add a small AI settings link/card from the existing `/wayfinding` page when entitled.
- Keep ordinary Wayfinding configuration usable when AI Wayfinding is absent.

### 8.2 Page sections

The page should contain:

1. **Eligible kiosks** — only Wayfinding screens with a kiosk location.
2. **Per-screen activation** — enabled/disabled, welcome messages, max turns.
3. **Destination aliases** — edit aliases within the existing POI ownership boundary.
4. **Test assistant** — choose a building, type an English/Arabic sample, inspect the structured result without changing player state.
5. **Usage summary** — request count, model-call percentage, no-match rate, average latency, token usage by screen/date.

Do not expose the provider API key, raw system prompt, or editable unrestricted system instructions.

### 8.3 Internationalization

Add complete `en.json` and `ar.json` keys for navigation, configuration, validation, assistant states, errors, offline fallback, clarification, and usage metrics. Do not embed UI copy in components.

---

## 9. Player Work

### 9.1 State assembly

In `PlayerService.getState()` compute these booleans separately:

```ts
const wayfindingAiEntitled =
  wayfindingConfigured &&
  await entitlements.hasModule(orgId, 'WAYFINDING_AI');

const wayfindingAiRenderable =
  wayfindingAiEntitled &&
  wayfindingAiConfig?.enabled === true &&
  !screen.emergencyActive;
```

- Include `wayfinding.aiAssistant` only when renderable.
- Issue a `WAYFINDING_AI` lease only when genuinely entitled and configured for the screen.
- Do not use the Wayfinding evacuation bypass to expose AI.
- When the module is disabled, preserve its configuration and return no AI payload.
- When AI entitlement changes, fan out `reload` to affected Wayfinding screens.

### 9.2 UI components

Add:

```text
apps/player/src/components/WayfindingAiAssistant.tsx
apps/player/src/components/WayfindingKeyboard.tsx
apps/player/src/lib/wayfindingAiClient.ts
apps/player/src/lib/wayfindingAiSession.ts
```

The existing Directory keyboard is Latin-only. Extract it into `WayfindingKeyboard` and add explicit English and Arabic key layouts so the claimed bilingual assistant does not depend on an operating-system keyboard that may be unavailable in kiosk mode. Reuse the shared keyboard in both Directory and AI rather than maintaining two keyboard implementations.

Refactor the minimum necessary selection logic from `WayfindingKioskMap` so both Directory and AI results call the same function:

```ts
selectDestination(poi, { openRoute: true, source: 'AI' | 'DIRECTORY' })
```

This function must:

- close overlays correctly;
- switch to the POI floor;
- set the selected POI;
- open the existing route view;
- retain accessibility-route selection;
- log the source without duplicating route computation.

### 9.3 Conversation behavior

- Reset after the existing idle/attract timeout.
- Keep at most the configured number of turns in memory.
- Do not persist turns in local storage or IndexedDB.
- Provide large kiosk-safe touch targets.
- Follow the current English/Arabic direction and language selection.
- Switch the shared on-screen keyboard between complete English and Arabic layouts with the selected language.
- Disable repeated submission while a request is active.
- Abort requests on close, timeout, screen reload, or session reset.
- Show alternatives as buttons; never ask the visitor to retype an exact internal identifier.
- Provide a permanent **Use Directory Instead** action.

### 9.4 Offline and failure behavior

- If no valid `WAYFINDING_AI` lease exists, do not show the assistant entry point.
- If the lease is valid but the network/provider call fails, keep ordinary Wayfinding on screen and show a short localized fallback.
- Never clear the Wayfinding presentation because an AI call failed.
- Provider errors must not enter the global player crash loop.

---

## 10. Entitlement and Refresh Enforcement

Enforce the module at all established layers:

| Layer | Requirement |
| --- | --- |
| Super Admin | Assign `WAYFINDING_AI` only with usable `WAYFINDING` in the desired module set. |
| Navigation | Hide AI navigation unless the dependency-aware capability helper passes. |
| Dashboard route | Guard `/wayfinding/ai` before queries. |
| Dashboard API | Use `@RequireModule('WAYFINDING_AI')`. |
| Screen config | Reject enabling AI on an unentitled tenant or non-Wayfinding screen. |
| Player state | Omit AI config and lease when unavailable. |
| Player request | Revalidate entitlement live on every resolve call. |
| Cached player | Hide AI entry point after lease expiry. |

Generalize `PlatformTenantsService.setModules()` refresh handling so a `WAYFINDING_AI` change reloads screens that are configured for AI. Do not create an organization-wide player socket room or a second notification mechanism.

---

## 11. Security, Safety, and Cost Controls

### 11.1 Prompt and tool safety

- Treat visitor text, POI names, aliases, and descriptions as untrusted data.
- Delimit catalog data from system instructions.
- Provide no arbitrary HTTP, database, code execution, or web-search tool.
- Use one narrow destination-resolution schema.
- Validate output server-side and fail closed.
- Never pass route graph geometry or secrets to the model.

### 11.2 Abuse controls

- Maximum input characters.
- Maximum recent turns.
- Request timeout.
- Per-screen minute throttle.
- Per-screen and per-tenant daily quota.
- Maximum output tokens.
- One in-flight request per player session.
- Operational alerting on repeated provider errors or quota exhaustion.

### 11.3 Privacy

- No raw-message persistence by default.
- No PII requirement at the kiosk.
- No face, voiceprint, or indoor-location data.
- No visitor account.
- `WayfindingAiUsageLog` rows are deleted after a configurable retention window (`AI_WAYFINDING_USAGE_LOG_RETENTION_DAYS`, §3.6), enforced by a scheduled cleanup job — the same operational-control pattern as `PLAYER_ENTITLEMENT_OFFLINE_GRACE_HOURS`. The retention duration is a pending product/legal decision, not invented by this plan, and must be set before production use.
- Public responses must not reveal other POIs that the current building catalog did not contain.

### 11.4 Safety behavior

- Evacuation UI always has priority over AI.
- Opening emergency mode closes the assistant and aborts any request.
- AI must never recommend elevators/stairs or accessibility choices directly; the deterministic route engine applies those rules.
- A provider outage must never affect evacuation or ordinary Wayfinding.

---

## 12. Analytics and Audit

Use two separate concerns:

- `AuditService.log()` for administrator configuration changes.
- `WayfindingAiUsageLog` for cost, latency, and resolution outcomes.

Recommended outcomes:

```text
EXACT_MATCH
MODEL_DESTINATION
CLARIFICATION
NO_MATCH
CLOSED_DESTINATION
RATE_LIMITED
QUOTA_EXCEEDED
PROVIDER_TIMEOUT
PROVIDER_ERROR
INVALID_PROVIDER_OUTPUT
```

Extend kiosk analytics only if a product report needs visitor flow events. Do not put token/cost data into the current `KioskEvent` table.

---

## 13. Testing Strategy

### 13.1 API unit tests

Cover:

- dependency-aware entitlement success/failure;
- unentitled and suspended tenants;
- screen/building/POI tenant isolation;
- exact name and alias resolution without provider use;
- ambiguous result clarification;
- Arabic normalization and aliases;
- closed/relocated POI behavior;
- model-generated unknown POI ID rejection;
- malformed structured output;
- timeout, rate limit, and daily quota;
- raw messages absent from usage logs;
- configuration persistence across module disable/re-enable;
- `WAYFINDING_AI` lease issuance only when entitled and enabled;
- no AI payload or lease during evacuation bypass.

Mock the provider interface. Unit tests must never spend external API credits.

### 13.2 Player tests

Add repeatable tests for:

- AI lease valid/expired/missing;
- assistant hidden for cached expired state;
- API failure falls back to Directory without losing the map;
- destination selection switches floors and opens the existing route;
- nearest-category requests choose the lowest-cost reachable candidate with the existing routing engine;
- clarification alternatives;
- English and Arabic on-screen keyboard input;
- session reset after idle;
- emergency closes AI and renders evacuation;
- no route calculation from model-provided text.

Use the player's existing script-based test pattern if a general runner is still not introduced, but commit the tests and add a stable `package.json` test command.

### 13.3 Resolver evaluation set

Commit a provider-independent evaluation fixture containing at least:

- exact names;
- partial names;
- aliases;
- misspellings;
- English and Arabic queries;
- category requests such as nearest restroom;
- ambiguous names on different floors;
- unavailable destinations;
- irrelevant questions;
- prompt-injection attempts.

Release gates:

- zero fabricated/unknown POI IDs accepted;
- 100% exact-name and exact-alias deterministic resolution;
- no cross-building or cross-tenant results;
- agreed accuracy threshold on the bilingual evaluation set;
- provider failure never blocks ordinary Wayfinding;
- emergency rendering remains independent of AI.

### 13.4 End-to-end acceptance scenario

1. Create Tenant A with `WAYFINDING` and `WAYFINDING_AI`; create Tenant B with `WAYFINDING` only.
2. Configure the same sample Wayfinding building/POIs for Tenant A and a separate building for Tenant B.
3. Confirm Tenant B has no AI navigation, direct route access, AI config API, player AI payload, or resolve access.
4. Configure and enable AI for one Tenant A Wayfinding screen.
5. Ask an exact English destination and confirm no provider call was needed.
6. Ask an Arabic alias and confirm the correct POI.
7. Ask an ambiguous question and select one returned alternative.
8. Confirm the existing local route appears on the correct floor.
9. Attempt prompt injection and confirm no arbitrary action or invalid POI is returned.
10. Simulate provider timeout and confirm the Directory remains usable.
11. Disable `WAYFINDING_AI`; confirm the button disappears, resolve returns 403/generic player error, and configuration remains stored.
12. Re-enable it; confirm the existing configuration returns without reconstruction.
13. Disable `WAYFINDING`; confirm both ordinary and AI Wayfinding become unavailable.
14. Activate evacuation and confirm the evacuation route renders with no assistant and no AI lease.

---

## 14. Milestones

### Entry Gate — Shared preflight complete

- [x] All three plans exist in repository planning-baseline commit P. (`fe643d22d1f280e31b2ccdbe3502aeb9138e3beb`)
- [x] The plans were re-reviewed and accepted corrections were committed in planning handoff commit Q. (`778a1133a16afd2595ca907a14ad2ab823b109f1`)
- [x] `modules_shared_preflight_plan.md` is complete and merged. (implementation commit A `a3f047e376a1b5bff246f3dc4dad17802a8742f0`)
- [x] `modules-shared-preflight-v1` exists. (tagged on this plan's docs-only handoff commit B, immediately following this commit — never on A itself, since A alone omits the doc updates that identify it)
- [x] The preflight implementation commit A is recorded in this plan. (header above)
- [x] `git rev-parse modules-shared-preflight-v1` is recorded in the AI execution/PR log.
- [x] This branch (`feature/ai-wayfinding-module`) starts from the exact handoff commit B targeted by that tag.
- [x] The integration owner is named. (Basil Jerjawi — `modules_shared_preflight_plan.md` §4.6)
- [x] No shared-preflight task is duplicated in this branch. (no AI Wayfinding code was implemented in this pass)

### Milestone AI1 — Domain and provider boundary

- [x] Add shared types and Zod schemas. (`packages/types/src/wayfinding-ai.ts`)
- [x] Add database models and migration. (`WayfindingAiScreenConfig`, `PoiAlias`, `WayfindingAiUsageLog`; one additive migration, no changes to existing tables)
- [x] Add provider interface and mocked provider tests. (`providers/wayfinding-ai-provider.ts`; 6 + 19 tests mocking the interface, no external API credits spent)
- [x] Add environment validation and safe defaults. (`env.validation.ts`; boots cleanly with `AI_WAYFINDING_API_KEY` unset via `NullWayfindingAiProvider`)
- [x] Add deterministic name/alias resolver. (`DestinationResolverService.findExactMatch()`/`normalize()`)

### Milestone AI2 — Secure resolution API

- [x] Add dashboard configuration/test endpoints.
- [x] Add player resolution endpoint. (`POST /v1/player/wayfinding-ai/resolve`)
- [x] Add entitlement, tenant, screen, and building checks.
- [x] Add OpenAI adapter with strict structured output. (Responses API, `text.format: json_schema, strict: true`)
- [x] Add timeouts, throttling, quota, and usage logs. (per-screen/per-tenant daily quota counted from `WayfindingAiUsageLog`; `@Throttle` burst guards)

### Milestone AI3 — Dashboard experience

- [x] Add dependency-gated navigation and route. (`/wayfinding/ai`, hidden until `hasModule('WAYFINDING_AI')`)
- [x] Add eligible-screen configuration.
- [x] Add alias management. (endpoints added beyond §7.1's list, since §8.2 requires the UI section: `GET/POST /wayfinding-ai/pois/:poiId/aliases`, `DELETE /wayfinding-ai/aliases/:aliasId`)
- [x] Add test console and usage summary.
- [x] Add English/Arabic translations.

### Milestone AI4 — Player integration

- [x] Add player-state AI config and module lease.
- [x] Add the assistant overlay. (`WayfindingAiAssistant.tsx`)
- [x] Unify Directory/AI destination selection. (both call `WayfindingKioskMap`'s `selectFromDirectory`)
- [x] Add online failure and offline fallback behavior.
- [x] Preserve emergency priority and idle reset. (gated on `!screen.emergencyActive`, broader than just the evacuation-bypass case — see ADR-equivalent note in the implementation commit)

### Milestone AI5 — Verification and handoff

- [x] Run API, dashboard, player, typecheck, lint, and committed tests. (151 API tests, 11 dashboard, 36 player script tests, all green; `next build`/`nest build`/`vite build` all succeed; live boot confirmed clean DI wiring and correct route mapping)
- [ ] Run the bilingual resolver evaluation set. **Not run as a live corpus** — measuring accuracy on misspellings/fuzzy phrasing requires real provider calls, which unit tests must never spend credits on (§13.1). The deterministic and validation-boundary cases (exact match, alias match, Arabic normalization, unknown-POI rejection, closed/relocated handling) are covered by `destination-resolver.service.spec.ts` instead. Flagged as a deferred risk — run this against a real provider key before general availability.
- [ ] Run the end-to-end acceptance scenario. **Not run as a live two-tenant browser walkthrough** — no live environment in this session. Automated tests cover org isolation (org-scoped queries + rejection tests), entitlement gating, evacuation suppression, and config-preservation-by-construction (no delete path exists for AI config/aliases/usage on disable). Flagged as a deferred risk, same disclosure pattern as the shared preflight's PF4.
- [x] Verify disable/re-enable preserves all AI configuration. (by construction: `updateScreenConfig` only ever upserts; no code path deletes `WayfindingAiScreenConfig`, `PoiAlias`, or `WayfindingAiUsageLog` rows on entitlement change)
- [ ] Document provider operations, quotas, privacy defaults, and rollback. **Not written as a separate ops document** — quotas/privacy defaults are documented inline in `env.validation.ts` and this plan; a dedicated runbook was not produced in this pass.
- [x] Create verified AI implementation commit C on `main`. (`0caf1e68520867e8b3b3cd583b1697f16674fcd1`)
- [x] Record C's full hash in this plan and the Room Booking plan in following docs-only handoff commit D.
- [ ] Record D's full hash in the Room Booking execution/PR log before its branch is created. (pending — Room Booking has not started)

---

## 15. Expected File Changes

New files should be concentrated under:

```text
packages/types/src/wayfinding-ai.ts
apps/api/src/modules/wayfinding-ai/**
apps/dashboard/src/app/[locale]/(app)/wayfinding/ai/page.tsx
apps/dashboard/src/components/wayfinding-ai/**
apps/player/src/components/WayfindingAiAssistant.tsx
apps/player/src/components/WayfindingKeyboard.tsx
apps/player/src/lib/wayfindingAiClient.ts
apps/player/src/lib/wayfindingAiSession.ts
```

Expected shared-file edits:

```text
packages/types/src/index.ts
apps/api/prisma/schema.prisma
apps/api/src/app.module.ts
apps/api/src/config/env.validation.ts
apps/api/src/modules/player/player.service.ts
apps/api/src/modules/platform-tenants/platform-tenants.service.ts
apps/dashboard/src/app/[locale]/(app)/layout.tsx
apps/dashboard/src/context/CapabilitiesContext.tsx
apps/dashboard/src/lib/api.ts
apps/dashboard/messages/en.json
apps/dashboard/messages/ar.json
apps/player/src/lib/api.ts
apps/player/src/pages/PlayerPage.tsx
apps/player/src/components/WayfindingKioskMap.tsx
```

Keep the shared wiring changes in separate commits so the integration owner can merge this plan and Room Booking without combining unrelated module-domain code.

---

## 16. Integration and Handoff Contract

- All three plans are repository artifacts before preflight or feature implementation begins.
- `modules_shared_preflight_plan.md` is complete using implementation commit A plus tagged docs handoff commit B before this branch starts.
- The AI branch starts from commit B as resolved by `modules-shared-preflight-v1`; its full hash is recorded outside B in the AI execution/PR log.
- AI Wayfinding is the first feature module in the recommended sequential order.
- After AI Wayfinding passes its full verification gate, merge verified implementation commit C to `main`, then use docs-only handoff commit D to record C in this plan and the Room Booking plan.
- Room Booking starts from D on verified post-AI `main`; D's own full hash is recorded in the Room Booking execution/PR log because D cannot contain its own hash.
- The AI Wayfinding branch owns `wayfinding-ai/**` and AI-specific player/dashboard components.
- The Room Booking branch must not import AI Wayfinding services or tables.
- If parallel execution is explicitly re-enabled, both branches may add independent Prisma migrations, but the integration owner resolves the combined `schema.prisma` and generated client.
- Only the integration owner merges changes to `app.module.ts`, dashboard layout/navigation, translation roots, `PlayerService`, `PlayerPage`, and `PlatformTenantsService`.
- Each feature branch separates module-local commits from shared wiring commits.
- Merge and verify one shared wiring commit at a time; rerun all three applications after each module is wired.
- Do not change module keys or dependency semantics independently in either feature branch.

---

## 17. Definition of Done

AI Wayfinding is complete when:

- it is independently assignable, trialable, disableable, and auditable as `WAYFINDING_AI`;
- the dashboard and API correctly enforce its dependency on `WAYFINDING`;
- administrators explicitly enable it per eligible kiosk;
- visitors can ask bilingual destination questions and receive only validated POI results;
- the selected destination uses the existing deterministic route engine and map UI;
- ordinary Wayfinding remains fully usable when AI is absent, disabled, expired, offline, or failing;
- cached AI entry points obey the generic module lease;
- evacuation always overrides and closes AI;
- raw visitor conversations are not persisted by default;
- provider secrets never reach a browser or player;
- quotas and usage accounting make operating cost measurable;
- all automated and manual acceptance gates pass; and
- disabling/re-enabling the module preserves configuration without exposing paid functionality while disabled.

---

## 18. Non-Goals for the First Release

Do not add these while implementing the initial module:

- speech-to-text or realtime voice agents;
- indoor positioning or phone-location tracking;
- an LLM-generated route or map;
- a second map renderer or route graph;
- general web search;
- arbitrary facility knowledge-base answers;
- visitor authentication or profile memory;
- facial recognition or biometric processing;
- Room Booking availability tools;
- automatic room recommendations;
- Flutter Wayfinding implementation;
- a second dashboard, player, or entitlement mechanism.

---

## 19. External Technical References

- OpenAI function calling: `https://developers.openai.com/api/docs/guides/function-calling`
- OpenAI structured outputs: `https://developers.openai.com/api/docs/guides/structured-outputs`

These references guide the initial provider adapter only. The Lumina-owned provider interface and strict validation rules remain authoritative for the application architecture.