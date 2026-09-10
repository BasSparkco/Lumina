# Designer2 M0-M3 + Signal shell — production deployment — 2026-09-09

The user requested immediate commit and production deployment of the working tree,
including designer2's M0-M3 modernization work (this session) and the previously
uncommitted Signal shell redesign (already deployed once on 2026-09-08 per
`docs/ui/signal-deployment.md`, but never committed to git until now). The M3
canvas/rotation/multi-select work had only been verified via jsdom unit tests before
this deploy — no browser visual verification, no fixture library, no staging pass.
The user was told this explicitly and chose to deploy anyway.

## Committed

- `45fcaf5` — `feat(designer2): modernization M0-M3 — persistent sync, direct media
  insertion, rotation/geometry contract`
- `3625079` — `feat(dashboard): Signal shell redesign — AppShell, SignalDialog,
  screens overview`
- Pushed to `origin/main` (`github.com:BasSparkco/Lumina`).

## Released

- Site: https://lumina.sparkco.vip
- Service: `lumina-dashboard-1` only.
- Release tag: `lumina-dashboard:designer2m3-20260909`.
- Running image: `sha256:aad558358fab91aebe9748f698d2d1f299ed7ed928be7e6c2787c2e8ed5c0f07`.
- Preserved rollback tag: `lumina-dashboard:pre-designer2m3-20260909`.
- Previous image: `sha256:2d0869ce8ac9620ca4ad0a367929509fd1099055d97631887a0f447ddc08c3eb`
  (`screens-20260908-9ojx`).

Built via `docker compose -f docker-compose.prod.yml build dashboard`, then
recreated with `docker compose -f docker-compose.prod.yml up -d --no-deps --no-build
dashboard` — same pattern as the 2026-09-08 Signal deployment. API, worker, player,
Postgres, Redis and MinIO were untouched (confirmed unchanged uptime after deploy).
No schema migrations or tenant data operations ran.

## Verification

- Isolated container smoke test (new image, no network deps) before deploy:
  `/en/login`, `/ar/login`, `/en/designer2` all HTTP 200; no runtime errors in logs.
- Post-deploy against the public site: `/en/login` 200, `/ar/login` 200,
  `/en/designer2` 200, unauthenticated `/v1/auth/me` 401 as expected.
- Pre-deploy: full dashboard `tsc --noEmit`, `eslint`, `vitest run` (95 tests,
  including 52 designer2 tests added/updated this session), and `next build` all
  passed locally before the image was built.
- No authenticated production tenant workflow, real-browser canvas interaction
  (drag/rotate/multi-select/text-resize), or physical-device test was run. The
  M3 canvas work's own status (see
  `docs/designer/designer_modernization_plan.md`) is explicitly partial: no fixture
  library, no DPR/zoom-pan visual tests, no legacy rotated-design normalization pass.
  Real-browser verification on this live deploy is the next step, not something
  this deployment itself confirmed.

## Rollback (first deployment)

If a regression in designer2 or the Signal shell requires reverting to before this
first deployment:

```bash
docker tag lumina-dashboard:pre-designer2m3-20260909 lumina-dashboard:latest
docker compose -f docker-compose.prod.yml up -d --no-deps --no-build dashboard
```

This does not revert the git commits — only the running container. Do not run the
rollback commands unless rollback is intended. No database rollback is necessary
(no migrations ran).

---

# Second deployment — M3 closeout + M4 selection fixes — 2026-09-09

Same session, same day. Commit `340e952`: M3 closeout (production verified to have
zero rotated designs — legacy-frame normalization confirmed moot; zoom-invariance
regression tests added) plus two M4 selection bugs fixed and regression-tested
(shift-click multi-select silently dropping the prior selection; a hidden/locked
layer able to become the canvas's active selection).

## Released

- Release tag: `lumina-dashboard:m4selection-20260909`.
- Running image: `sha256:1e90dc162b495e97330569238d14779a6e1cbd4d91abac848fdfae40ac55f61b`.
- Preserved rollback tag: `lumina-dashboard:pre-m4selection-20260909`.
- Previous image: `sha256:aad558358fab91aebe9748f698d2d1f299ed7ed928be7e6c2787c2e8ed5c0f07`
  (`designer2m3-20260909`, the first deployment above).

Same build/smoke-test/switch pattern as the first deployment. The actual
`docker compose ... up -d --no-deps --no-build dashboard` swap-over was blocked by
Claude Code's auto-mode classifier on the first attempt (a high-risk-action gate);
the user explicitly confirmed and it was re-run successfully. API, worker, player,
Postgres, Redis and MinIO were untouched. No schema migrations ran.

## Verification

- Isolated container smoke test before deploy: `/en/login`, `/ar/login`,
  `/en/designer2` all HTTP 200, no runtime errors in logs.
- Post-deploy against the public site: `/en/login` 200, `/ar/login` 200,
  `/en/designer2` 200, unauthenticated `/v1/auth/me` 401 as expected.
- Pre-deploy: full dashboard `tsc --noEmit`, `eslint`, `vitest run` (102 tests) and
  `next build` all passed locally before the image was built.
- Same caveat as the first deployment: no authenticated production tenant workflow
  or real-browser canvas interaction test was run. Still jsdom-verified only.

## Rollback (second deployment)

```bash
docker tag lumina-dashboard:pre-m4selection-20260909 lumina-dashboard:latest
docker compose -f docker-compose.prod.yml up -d --no-deps --no-build dashboard
```

To roll back further, past the first deployment too, use
`lumina-dashboard:pre-designer2m3-20260909` instead. Do not run either rollback
command unless rollback is intended. No database rollback is necessary.

---

# Third deployment — API server-side Template policy enforcement — 2026-09-10

Different service from the first two: `apps/api`, not the dashboard. Commit
`b41c4f5`: `DesignsService.assertTemplatePolicyRespected`, enforced on every
manual save of a design cloned from a Template, checked against the immutable
`DesignTemplateVersion`.

## Released

- Service: `lumina-api-1` only.
- Release tag: `lumina-api:m4policy-20260910`.
- Running image: `sha256:d31370e85e92e69787b5b84d7481bb2d9dbcd9529211da99b3afde91ccb71847`.
- Preserved rollback tag: `lumina-api:pre-m4policy-20260910`.
- Previous image: `sha256:6153a0aa5ed4951d8e2ae04843df16253e43e22516d4b07b09c8cbb6bf64a010`.

Built via `docker compose -f docker-compose.prod.yml build api`, recreated with
`docker compose -f docker-compose.prod.yml up -d --no-deps --no-build api`.
Dashboard, worker, player, Postgres, Redis and MinIO were untouched (confirmed
unchanged uptime after deploy). No schema migrations ran.

## Broader blast radius than the dashboard deploys

Unlike the dashboard (only reached by admin/browser users), the API is also called
directly by `lumina-player-1` — the actual kiosk/signage displays. A restart briefly
interrupts anything mid-request against it, though it reconnects automatically like
any container restart. The user was told this explicitly before confirming.

## Verification

- Smoke test before deploy used `docker compose run --rm --no-deps` (not a bare
  `docker run`) so it got the exact same env/network wiring as the real service —
  including the live Postgres/Redis/MinIO — without touching the running container.
  Booted clean, all routes mapped (including the modified `PATCH /designs/:id`),
  `/v1/auth/me` and `/v1/designs` both 401 unauthenticated as expected, no
  exceptions in logs.
- Checked production directly beforehand: 0 of the 8 existing `DesignAsset` rows
  have a `sourceTemplateId` set, so the new enforcement branch is a complete no-op
  for all current traffic — it only activates the first time a tenant actually
  clones a design from a Template.
- Post-deploy against the public site: `/v1/auth/me` 401, `/v1/designs` 401,
  player domain reachable, dashboard `/en/login` still 200, no errors in API logs
  in the 30s after restart.
- Pre-deploy: full API `tsc --noEmit`, `eslint`, `jest` (284 tests, 26 suites,
  including 8 new policy-enforcement tests each confirmed to depend on the fix),
  and `nest build` all passed locally before the image was built.
- Same caveat as the other deployments: no authenticated end-to-end exercise of
  the new enforcement path against a real cloned-from-template design was run
  (none currently exist in production to test against). Unit-test coverage only.

## Rollback (third deployment)

```bash
docker tag lumina-api:pre-m4policy-20260910 lumina-api:latest
docker compose -f docker-compose.prod.yml up -d --no-deps --no-build api
```

Do not run this unless rollback is intended. No database rollback is necessary
(no migrations ran).

---

# Fourth deployment — Layers panel action discoverability — 2026-09-10

Back to the dashboard. Commit `4e61f6b`: rename/visibility/lock/duplicate/delete/
reorder made directly reachable from a Layers-panel row (previously only reachable
via the Properties panel expansion or canvas right-click), plus keyboard-accessible
drag reorder. This closes designer_modernization_plan.md's M4 task list in full.

**Note on image tags**: by this deployment, the tags from the first and second
dashboard deployments (`designer2m3-20260909`, `pre-designer2m3-20260909`,
`screens-20260908-9ojx`) were no longer present on this host — likely pruned
between sessions. Only `m4selection-20260909` (the second deployment's release)
remained, so that's what this deployment's rollback tag was taken from. The
rollback chain effectively now only reaches back to the second deployment, not
further. If deeper rollback is ever needed, check `docker images` for what's
actually still present before assuming any tag below still exists.

## Released

- Release tag: `lumina-dashboard:m4layers-20260910`.
- Running image: `sha256:0a0e5c1376c9bfe8711eaf3988c72763548b4b371d3ca9e4175bbdfe47528b1a`.
- Preserved rollback tag: `lumina-dashboard:pre-m4layers-20260910` (= the second
  deployment's `m4selection-20260909` image).
- Previous image: `sha256:1e90dc162b495e97330569238d14779a6e1cbd4d91abac848fdfae40ac55f61b`.

Same build/smoke-test/switch pattern as every dashboard deployment above. Only
`lumina-dashboard-1` was recreated; api/worker/player/Postgres/Redis/MinIO kept
their original uptime. No schema migrations ran.

## Verification

- Isolated container smoke test before deploy: `/en/login`, `/ar/login`,
  `/en/designer2` all HTTP 200, no errors in logs.
- Post-deploy against the public site: `/en/login` 200, `/ar/login` 200,
  `/en/designer2` 200, unauthenticated `/v1/auth/me` 401 as expected, no errors
  in logs.
- Pre-deploy: full dashboard `tsc --noEmit`, `eslint` (0 errors), `vitest run`
  (110 tests, including 8 new Layers-panel tests), and `next build` all passed
  locally before the image was built.
- Same caveat as every other deployment this session: no real-browser interactive
  test of the new rename/toggle/actions-menu UI was run against the live site
  (jsdom + React Testing Library only). Worth a manual click-through on the live
  dashboard given this is UI a real user directly interacts with.

## Rollback (fourth deployment)

```bash
docker tag lumina-dashboard:pre-m4layers-20260910 lumina-dashboard:latest
docker compose -f docker-compose.prod.yml up -d --no-deps --no-build dashboard
```

---

# Fifth deployment — M5 property updates and text editing (both services) — 2026-09-10

Commit `50cb488`: closes M5's full task list — full live-property adapter mapping,
image style edits patch in place instead of recreating the Fabric object,
`useEditSession` begin/preview/commit/cancel hook, color-drag/no-op history fixes,
bound-text read-only fix, font-ready measurement, template-policy field gating in
the Properties panel. Touches both `apps/dashboard` (the bulk of the work) and
`apps/api` (a behavior-preserving refactor: `designs.service.ts`'s
`CONTENT_PROPS_BY_TYPE`/`STYLE_PROPS_BY_TYPE` tables moved to a new shared
`packages/design-schema/src/templatePolicyFields.ts` module, now also consumed by
the dashboard's adapter). See `docs/designer/designer_modernization_plan.md`'s M5
implementation record for the full technical detail, including a regression caught
and reverted mid-session (a hook-level history no-op safety net that would have
silently broken Undo for every editor sharing `useEditorHistory`, not just
designer2 — never shipped).

## Released

- Services: `lumina-dashboard-1` and `lumina-api-1`.
- Dashboard release tag: `lumina-dashboard:m5props-20260910`.
  Running image: `sha256:87f54677b3b5664c71b5ab3bd15db2f43850e96c1dd2aa4b66e52fa36bf7ec51`.
  Preserved rollback tag: `lumina-dashboard:pre-m5props-20260910` (= the fourth
  deployment's `m4layers-20260910` image).
- API release tag: `lumina-api:m5props-20260910`.
  Running image: `sha256:92629052aabfdb492234eeaf215e4bf5f6f0654748c21cae3d4177044b12de19`.
  Preserved rollback tag: `lumina-api:pre-m5props-20260910` (= the third
  deployment's `m4policy-20260910` image).

Built via `docker compose -f docker-compose.prod.yml build dashboard` and
`... build api`, recreated with `docker compose -f docker-compose.prod.yml up -d
--no-deps --no-build dashboard` then `... api` (two separate recreates, not
simultaneous). Worker, player, Postgres, Redis and MinIO kept their original
uptime (confirmed unchanged before/after). No schema migrations ran. Same broader
blast-radius note as the third deployment applies to the API half: `lumina-player-1`
(the kiosk/signage displays) calls this API directly and briefly reconnects across
the restart.

## Verification

- Isolated container smoke tests before deploy (`docker compose run --rm
  --no-deps`, same env/network wiring as the real services, no host container
  touched): dashboard — `/en/login`, `/ar/login`, `/en/designer2` all HTTP 200, no
  errors in logs; API — every route mapped (including `PATCH /designs/:id`),
  `/v1/auth/me` and `/v1/designs` both 401 unauthenticated as expected, no
  exceptions in logs.
- Post-deploy against the public site: `/en/login` 200, `/ar/login` 200,
  `/en/designer2` 200, `/v1/auth/me` 401, player domain reachable (200), no
  errors in either service's logs in the first two minutes after restart.
- Pre-deploy: full dashboard `tsc --noEmit`, `eslint` (0 errors), `vitest run`
  (142 tests, up from 110 — 32 new: 10 `useLiveField`/`useEditSession`, 12
  `PropertiesPanel`, 10 extended `FabricCanvasAdapter`), and `next build` all
  passed locally. Full API `tsc --noEmit`, `eslint` (0 errors), `jest` (284
  tests, unchanged — the `designs.service.ts` refactor is behavior-preserving,
  re-verified directly), and `nest build` all passed locally. `pnpm --filter
  @lumina/design-schema build` run first so both apps picked up the new shared
  module (neither app is in `transpilePackages` for this workspace package —
  Next.js/Nest both resolve it via its built `dist/`, not source).
- Same caveat as every prior deployment: no real-browser interactive test of the
  Properties panel's live-drag/color-picker/crop/adjust UI was run against the
  live site (jsdom + React Testing Library only). This is the exact "live-editing
  feel" work the plan doc's HANDOFF NOTES flagged as the single biggest
  verification gap across the whole M0-M5 effort — worth a manual click-through
  on the live dashboard, or setting up the Playwright/Chromium harness mentioned
  there, before trusting this beyond what jsdom can confirm.

## Rollback (fifth deployment)

```bash
# Dashboard
docker tag lumina-dashboard:pre-m5props-20260910 lumina-dashboard:latest
docker compose -f docker-compose.prod.yml up -d --no-deps --no-build dashboard

# API
docker tag lumina-api:pre-m5props-20260910 lumina-api:latest
docker compose -f docker-compose.prod.yml up -d --no-deps --no-build api
```

Do not run this unless rollback is intended. No database rollback is necessary
(no migrations ran).

---

# Sixth deployment — image position-drag bugfix (dashboard only) — 2026-09-10

Commit `9f34107`, reported by the user directly: inserting an image then just
moving it made the image visibly jump down-right within its box, showing only
~25% of it — a regression from the fifth deployment (M5). Root cause: the new
`applyImageStylePatch` (added in M5 so image style edits patch in place
instead of recreating the object) reused `positionImageInBox`'s left/top
formula on an image that was *already* inside its Fabric Group. That formula
is only correct once, at Group construction — Fabric's own one-time
initialization layout pass unconditionally lands a single centered-origin
child back at local (0,0) regardless of what left/top it's given (all crop
panning actually happens via the clipPath Rect moving instead, since a
clipPath isn't a group child and isn't subject to that pass). Applying the
same formula a second time, after that pass has already run, has no such
correction behind it — the value stuck, shifting the image by half its box in
each dimension on every subsequent property update, including a plain
position change. Confirmed by reproducing it directly (a throwaway debug
test, deleted afterward — not part of the shipped test suite) and reading
Fabric's actual `Group`/`LayoutManager` source rather than guessing further.
Fix: `positionImageInBox` gained a `repositionInBox` option (default true,
unchanged for the creation path); the already-grouped-image update path now
passes `false`, so it only recomputes scale and the clip-pan offset and
leaves the image's already-correct position alone. See
`docs/designer/designer_modernization_plan.md`'s M5 implementation record,
amended with this fix, for the full technical detail.

## Released

- Service: `lumina-dashboard-1` only. `apps/api` untouched this deployment.
- Release tag: `lumina-dashboard:m5imgfix-20260910`.
  Running image: `sha256:d60a1a757d6048865c0a90f3cf60dc413aeb1dc04591d76808cf94a5828d9b91`.
  Preserved rollback tag: `lumina-dashboard:pre-m5imgfix-20260910` (= the
  fifth deployment's `m5props-20260910` image).

Built via `docker compose -f docker-compose.prod.yml build dashboard`,
recreated with `docker compose -f docker-compose.prod.yml up -d --no-deps
--no-build dashboard`. API, worker, player, Postgres, Redis and MinIO kept
their original uptime. No schema migrations ran.

## Verification

- Isolated container smoke test before deploy (`docker compose run --rm
  --no-deps`): `/en/login`, `/ar/login`, `/en/designer2` all HTTP 200, no
  errors in logs.
- Post-deploy against the public site: `/en/login` 200, `/ar/login` 200,
  `/en/designer2` 200, no errors in logs in the minute after restart.
- Pre-deploy: full dashboard `tsc --noEmit`, `eslint` (0 errors), `vitest run`
  (143 tests, up from 142 — one new regression test asserting the image never
  moves within its box on a position-only change, live or commit, and that a
  genuine crop-offset change still moves the clip window by the correct
  amount), and `next build` all passed locally.
- Reproduced the exact reported bug first (position-only update shifting
  `img.left`/`img.top` away from their established (0,0)), confirmed the fix
  resolves it, then wrote the regression test against the fixed code — not
  written blind.
- Same caveat as every deployment in this effort: no real-browser interactive
  verification against the live site was performed (jsdom + a targeted
  reproduction test only). Worth a manual check on the live dashboard —
  insert an image, drag it, confirm it stays fully visible and correctly
  positioned — given this is the exact symptom that was reported live.

## Rollback (sixth deployment)

```bash
docker tag lumina-dashboard:pre-m5imgfix-20260910 lumina-dashboard:latest
docker compose -f docker-compose.prod.yml up -d --no-deps --no-build dashboard
```

Do not run this unless rollback is intended. No database rollback is necessary.
