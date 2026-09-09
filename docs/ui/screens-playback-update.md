# Screens connection, playback and ordering

The overview now uses a green screen icon for Online and a muted icon for Offline, with accessible status labels and tooltips. Assigned content precedes Player. Player shows the reported elapsed/total video time, distinguishes pause from advancing playback, and expires confirmation after 10 seconds without telemetry. It never derives playback confirmation from the connection status or assigned content.

Existing players only report progress for supported controllable ASSET videos. Playlist images do not currently report their remaining duration. They therefore show Playback unconfirmed. Adding that telemetry requires a separate player change; this dashboard update does not alter the player or backend.

Both Overview rows and Controls cards use the existing screens reorder endpoint. Pointer and keyboard dragging are available only to editors with the full unfiltered fleet visible. Reordering is disabled during a save. The management dialog remains non-sortable. No permission, authentication, entitlement or database behavior changed.

Validation: dashboard unit suite (43 tests), TypeScript check, isolated optimized build, and focused browser verification across English/Arabic, light/dark and desktop/mobile. Browser fixtures contain no customer data; production playback was not visually inspected.

Deployed on 2026-09-08 at 11:27 UTC. Build: `9OJxOqQqGtgfp0fVdEAhc`. Only the dashboard container was recreated; API, worker, player and storage service image/start times were unchanged. Public login returned 200 and the served management CSS matched the tested artifact byte for byte. Rollback image: `lumina-dashboard:pre-screens-20260908`. Deployment and public verification records are retained in `release-records/screens-deployment.json` and `release-records/screens-public-checks.json`. Temporary browser fixtures and screenshots were removed after review.
