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

Do not run this unless rollback is intended. No database rollback is necessary.
