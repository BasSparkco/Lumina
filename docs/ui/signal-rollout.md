# Signal UI rollout

Design approved in the conversation on 2026-09-08. Implementation is staged to preserve the existing product behavior. This record supersedes the original prototype's awaiting-approval status.

## Implemented in this change

### Stage 1 — management foundation and shell

- Added `signal.css` at the authenticated App Router layout, with explicit Light/Dark surfaces, borders, typography, focus states and interaction colors.
- Kept `globals.css`, the editor palette and player untouched. The `signal-management` compatibility boundary maps existing deck tokens to opaque Signal surfaces. Designer and Designer2 retain their own theme and full-height content. Root authentication, theme initialization, query cache and locale providers are unchanged.
- Added a shared application shell with Lumina branding, responsive/collapsible sidebar, persistent theme/language controls, workspace/platform context, skip link, keyboard-contained mobile drawer and focus restoration.
- Kept the existing sidebar storage preference and automatic collapse/restore on entering/leaving the legacy editor. Designer2 still controls its full-width navigation drawer through `AppSidebarContext`.
- Preserved unsaved editor navigation protection for links and logout, and applied the same guard to language switching. Language changes preserve query parameters and anchors.
- Moved navigation metadata into a presentation-only module. Every existing route remains accessible under the same permission/module conditions, including both editors. Module visibility still waits for the existing capability resolver; billing remains hidden. Platform administration is a distinct section, gated by `isSuperAdmin`, not tenant role.
- Replaced substring active matching with one longest path-segment match. Arabic navigation uses logical spacing and an explicit RTL shell.

### Stage 2 — Screens and media library

- Screens defaults to a readable fleet overview: name/group, connection, assigned content, last seen and Manage. Counts use paired screens; status uses the existing WebSocket override before the API snapshot.
- Added combined status/search/group filtering. The overview never claims that online means playing, or that offline means cached playback stopped. Emergency/stopped states remain separately visible.
- Manage opens the **existing control-card markup and handlers** inside a native dialog. Editing, permissions, stream-type/module restrictions, publishing, maintenance and all other device actions retain their original API calls.
- Kept a Controls & ordering view for the complete existing card workflow. Reordering remains available only without search/group/status filters and only for permitted users. Unpaired-device history and group publishing remain available.
- Migrated pairing to a labeled native dialog/form. The same uppercase code is sent to the same pairing endpoint; the existing post-pair naming step is retained. No combined API transaction or fake prototype data was introduced.
- Added an explicit screen-query failure message, instead of presenting a failed request as an empty fleet.
- Media library now uses the approved surfaces, readable three-column desktop cards, responsive layouts, logical search spacing and keyboard-visible preview cues. All original source tabs, upload behavior, processing/error states, library authority and asset actions remain.
- On very narrow screens media cards use one column to retain existing action controls; source tabs wrap instead of overflowing. This is an intentional production adaptation of the prototype.

No changes to API/backend code, database, authentication, permissions, tenant isolation, module definitions, player behavior, shared renderer packages, dependencies or lockfiles. The original proposal and temporary review artifacts were removed after implementation and deployment at the user’s request.

## Verification and review artifacts

Before edits, dashboard TypeScript and the existing 8 tests passed. Verification after implementation includes:

- Dashboard TypeScript (`pnpm --filter dashboard typecheck`).
- ESLint on every changed/new TypeScript file, including shell/navigation and screen workflow tests.
- Dashboard Vitest: 35 tests, including live-status precedence, combined filters, exact publish target, viewer restrictions, filtered reordering, query failures, auth loading, platform separation, fail-closed module navigation, unsaved-change guards and theme/locale behavior.
- Existing module-capability suite: 11 tests covering trial expiry, inactive dependencies, suspended tenants and cycles.
- Full optimized Next.js build using webpack in `/tmp/lumina-signal-validation`, with the existing installed dependencies. Neither the active build directory nor any production service is used for this build.
- The temporary browser harness (removed after review) started and stopped its own loopback-only test server. A fresh browser context uses an explicitly fake cookie and intercepts **every** API request with fixtures. No production login, tenant data or real mutations are involved. Runtime URLs are compiled to loopback only.

Browser screenshots and temporary result files were removed after review. They showed the migrated application code with sample data, not the standalone design mockup and not live tenant records. The browser suite covers Screens/Assets/Playlists in English/Arabic, Light/Dark and 1440px/390px; real management/pairing dialogs, request payloads, post-pair naming and input focus, mobile navigation and role/module visibility.

## Stage 3a — playlist overview and dialogs

- Migrated the playlist overview to Signal page spacing, wrapping row controls and readable bilingual metadata. Duration and size use isolated LTR spans inside Arabic text.
- Replaced the mouse-only row expansion with an explicitly named, keyboard-accessible disclosure button with expanded state. Inline renaming remains available through the name button.
- Moved creation and playback settings into the shared native dialog, with focus containment, Escape handling and accessible labels. Create errors are visible; existing mutation payloads, immediate settings saves and edit gates remain unchanged.
- Linked rejection reasons to their labels and named the delete action. Existing approval, duplication, item editing and ordering logic is preserved.
- Added two settings regression tests: exact configuration update payload and read-only controls. TypeScript, targeted ESLint and all 33 dashboard tests pass.
- Extended browser validation to 24 page/theme/locale/viewport combinations, plus create/settings dialogs in all eight language/theme/width combinations. Screenshots are in the existing implementation gallery. The initial overview slice has since been extended with three actual item fixtures and expanded item-editor/picker captures.

## Stages 3b and 4 — remaining management presentation

- Applied the Signal page rhythm to Dashboard, Members, Settings, Schedules, Display Power, Reports, Audit Log, Wayfinding, AI Wayfinding, Room Booking and platform tenant/template management. The Templates library is scoped from its route wrapper; shared design canvases and their editor source remain unchanged.
- Migrated the playlist asset picker and local member/module/platform modals to the shared native dialog. Added associated field labels, named item controls, localized asset types/sorting/dates and responsive item controls. Existing API payloads, playback configuration, approval gates and mutation handlers remain.
- Added recoverable query failure presentation for playlist and member lists; failures no longer appear as a successful empty list. Member invitation regression tests cover the exact existing email/role payload and the exclusion of OWNER from the invite selector.
- Management forms wrap on narrow screens; two-column fields stack. Calendar weekday selectors now wrap rather than extending outside their card. Module assignment status/expiry controls can wrap, and status selectors are named without changing dependency validation.
- Localized platform template management in both languages, including metadata, publication states, visibility, archive confirmation and tenant-access copy. Removed internal implementation references from its product description. The table retains horizontal scrolling when columns need it.
- Added `signal-release.md` describing candidate/staging acceptance, dashboard-only release boundaries and whole-artifact rollback. No deployment command has been executed.

## Validation scope and remaining acceptance

The expanded browser harness covers 17 management routes in English/Arabic, Light/Dark and 1440px/390px (136 page cases), plus selected open forms, expanded playlist items and the picker. Fixtures include members/invites, schedule rules, a room, a building, a platform tenant, a layout and a platform template. The suite checks runtime errors, untranslated-message errors, route/role boundaries and horizontal overflow, including open forms. Temporary browser artifacts were removed after review; this document retains the validation summary.

Screenshots are viewport captures; long internal scrolling pages continue below the captured area. Specialized map editing, reservation/calendar integration, external Microsoft 365 synchronization, AI resolution, large production datasets and physical player operation require authorized staging acceptance. They are not claimed as verified by mocked browser responses. Existing complex canvas logic was deliberately preserved.

The source presentation migration is ready for review; the next step is staging acceptance from `signal-release.md`, followed by separate production deployment approval. No claim of a production release or zero possible regressions is made.

## Rollback and release boundaries

The production service is unchanged. For a release, use the normal build artifact workflow after staging acceptance. Rollback should restore the previous dashboard artifact as a unit; no database rollback is required. Source changes are limited to authenticated management presentation, dialog shells, associated labels, additive localization and tests. Keeping the original control view allows users to retain their existing screen workflow while adapting to the overview.

Do not ship the browser fixture server or point production API configuration to the validation loopback address. No fixture files or test API routes were added to the application public directory in the repository; sample media exist only in the temporary validation checkout and review artifacts.

## Pre-release follow-up

The normal Turbopack build, standalone packaging, real API/browser tests and rollback image capture are now complete. See [pre-release results](signal-pre-release-results.md). External storage/worker, real-device and provider acceptance remains pending; production is unchanged.

## Production deployment

The user waived staging and explicitly authorized production deployment on 2026-09-08. The verified candidate is now deployed to the dashboard only; see [deployment record](signal-deployment.md).
