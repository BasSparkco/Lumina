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
