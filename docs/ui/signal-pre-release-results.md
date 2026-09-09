# Signal pre-release verification — 2026-09-08

**Deployment update — 2026-09-08:** The user explicitly waived staging and authorized immediate production deployment. Signal is now deployed to the dashboard only. See [deployment record](signal-deployment.md). Earlier pending-approval/undeployed statements below describe the pre-release checkpoint and are superseded by this update.

Status: local release-candidate checks passed. Production deployment has not been performed. Full external-environment acceptance remains pending.

## Completed

| Check | Result | Evidence |
| --- | --- | --- |
| Normal dashboard production build | Passed with Next.js 16.2.11 default Turbopack | Temporary artifact removed after review |
| Standalone runtime assembly | Static files and production public directory packaged; no sample media | Temporary artifact removed after review |
| Source snapshot | Candidate application source/shared packages/lockfile hashes match the working tree at verification | Candidate manifest |
| Existing real API integration suites | 71 tests passed against disposable Postgres/Redis | Temporary artifact removed after review |
| Real browser → API → database workflows | 4 additional tests passed using the standalone candidate, total **75 tests / 8 suites** | Temporary artifact removed after review |
| Production preservation | Dashboard image ID and start time unchanged | Temporary artifact removed after review |
| Cleanup | Temporary review containers removed | `cleanup-result.json` |

Previously completed UI validation remains applicable because application source was not changed in this pre-release step: 35 dashboard tests, 11 module capability tests, and 136 rendered page/theme/locale/width combinations. The 136 visual cases used intercepted sample responses; they are separate from the new real API tests.

The four real browser workflows verified:

1. Playlist creation, adding a real database asset reference, changing item duration and playback order. Database checks confirmed the intended tenant changed and another tenant did not.
2. Approval and rejection persisted correctly; an empty rejection comment left the confirmation disabled.
3. Native room creation persisted capacity and the existing provider/privacy defaults, without connecting a calendar service.
4. A real fixture VIEWER credential could not edit item duration or access Members; the Arabic route rendered RTL.

The browser requests were forwarded to a real isolated Nest test server; API responses were not fabricated. Authentication used the existing test fixture's signed JWTs. Postgres started empty, received the repository migrations, and was destroyed afterward. Neither the existing development database nor production data was used. The API test bootstrap preserves guards, validation and database behavior, but does not reproduce production CORS or multi-process Redis fan-out. Media file bytes, external providers and physical players were not covered by these workflows.

## Unpublished candidate

- Archive: `/tmp/lumina-signal-candidate-standalone.tar.gz`
- SHA-256: `252453d80b0e5497ef4a0e1c964f20770196e382f01c5a05f1d3bbc02be4f270`
- Next build ID: `7Pk6u71jRrGmJDA2tesiY`
- Snapshot: `/tmp/lumina-signal-candidate`
- Runtime entry: `apps/dashboard/server.js` inside the archive.

Public API, WebSocket and player hostnames were derived from the current public routing configuration and the production Compose build-argument mapping. No production secrets or `.env` files were copied. The archive is a standalone dashboard artifact, **not** a built Docker image. It represents the current working-tree snapshot, not a new Git commit. Preserve the archive/manifest together and rebuild/revalidate if application source or build configuration changes.

The active rollback image ID was recorded before testing. No tag replacement, container recreation, Compose deployment, backend change or production migration was executed.

## Pending acceptance

The currently visible containers include production services and separate development data services, but no running dedicated staging dashboard/API pair was identified. The user has been asked for staging access and dedicated test devices; no access details have been supplied in this session.

Before marking full acceptance complete, use an explicitly designated environment for:

- Real media upload, worker processing and object storage retrieval.
- Physical screen pairing, live status, publishing and actual cached/offline playback.
- Microsoft 365/webhook synchronization and configured AI provider behavior.
- Production-equivalent origin/CORS, proxy routing and multi-process WebSocket transport.

These checks need the staging URL, an approved method of accessing role-specific test accounts, dedicated player identifiers and any configured test integrations. They must not be silently redirected to production. See `signal-release.md` for the release/rollback procedure. Production deployment is still a separate approval step after the remaining acceptance decision.
