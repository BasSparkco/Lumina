# Signal release and rollback plan

**Deployment update — 2026-09-08:** The user explicitly waived staging and authorized immediate production deployment. Signal is now deployed to the dashboard only. See [deployment record](signal-deployment.md). Earlier pending-approval/undeployed statements below describe the pre-release checkpoint and are superseded by this update.

Status: an unpublished standalone candidate now passes the normal production build and real API integration checks. See [pre-release results](signal-pre-release-results.md) for the artifact, hashes and outstanding external-environment acceptance. The older visual-review build remains unsuitable for release because its API/WebSocket URLs point to localhost and its public media are fixtures.

## Release unit

Release the dashboard as one artifact after staging acceptance. Keep the API, worker, player, database and shared renderers at their existing versions. There are no schema migrations, dependency changes or data conversion steps in this redesign.

The repository dashboard Dockerfile builds Next.js and packages `.next/standalone`, `.next/static` and `public`. Use the existing deployment pipeline and its actual target environment values for `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL` and `NEXT_PUBLIC_PLAYER_URL`; these are compiled at build time. Do not copy `/tmp/lumina-signal-validation/.next` or its public fixtures into a release. Do not run the root production Compose command as a shortcut: it can rebuild/recreate unrelated services.

Before release, record the current dashboard image digest/artifact and the candidate digest in the release ticket. Build a clean candidate with the committed source, frozen lockfile and the normal dashboard build command. Keep design-review screenshots, fixture harnesses and sample credentials outside the served application.

## Staging acceptance

Use authorized staging accounts and data to verify:

1. Tenant VIEWER, EDITOR, ADMIN and OWNER, plus a platform administrator whose tenant role is VIEWER. Confirm module trial/dependency visibility against real staging entitlements.
2. Theme persistence, English/Arabic switching, browser Back, mobile drawer and keyboard navigation. Enter both design editors and confirm dirty-document navigation protection.
3. Screens overview and controls, pairing/naming, content assignment and publish targets. Check live updates on staging devices.
4. Playlist add/remove/order, duration, full-video playback, mute, crop, transitions, submission, approval and rejection. Compare the request payloads and resulting content against the previous dashboard.
5. Media upload/processing, each source tab, template editing links, scheduling and power-rule targeting/timezones. Preserve existing scheduling semantics.
6. Room reservations, Microsoft 365 configuration, wayfinding floors/maps/routes and AI configuration with appropriately licensed staging tenants. Browser fixtures validate presentation; they do not validate external integrations or physical player behavior.
7. Platform tenant/module forms, template visibility and selected-tenant access. Review long names, empty/error states and sufficiently large datasets for pagination and horizontal table scrolling.

Production deployment remains a separate explicit approval step. After deployment, smoke-test the approved routes and observe frontend errors, failed API calls and ordinary management tasks. No backend restart is required by these source changes.

## Rollback

Restore the previous complete dashboard artifact/image through the normal deployment mechanism if a material regression appears. Do not selectively restore CSS while keeping the new shell: markup and theme tokens form one release unit. Retain the candidate artifact and reproduction details for diagnosis. No database rollback or user data rewrite is needed. Theme and sidebar preferences use the existing storage keys.
