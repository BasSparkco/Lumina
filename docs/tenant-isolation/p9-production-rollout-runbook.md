# P9 Production Rollout & Rollback Runbook

**Status: document only — no production deployment or production data mutation has been executed under this runbook.** Prepared per `docs/tenant_isolation_and_platform_admin_plan.md` §P9 rollout sequence (steps 1–11) and the plan's exit gate. Every step below requires explicit sign-off before it runs against production; this document does not authorize any of them.

**Scope note:** the tenant-isolation application code itself (P1–P5a, P6a/b, P7, P8) is already deployed to production per their own status sections in this file — this runbook is specifically about the *P9 verification/rollout* work: confirming the already-deployed state is sound, and the specific still-pending pieces (legacy media route retirement, optional P5b RLS if ever selected). Re-read each phase's own "Status" line before executing a step below, since this document does not restate that detail.

---

## 0. Preconditions (must all be true before step 1)

- [ ] This runbook has been reviewed and approved by whoever owns the production database and object storage for this deployment.
- [ ] The full automated verification suite passes on the commit being rolled out: `pnpm --filter api test`, `pnpm --filter api test:e2e`, `pnpm --filter dashboard test`, `pnpm lint`, `pnpm typecheck` (see the companion P9 checklist doc for current pass/fail status per requirement).
- [ ] A maintenance/communication window is agreed if step 8 (disabling legacy media routes) or step 9 (RLS enforcement, if selected) is expected to cause any visible effect.
- [ ] Rollback owners for each of: database (backup/restore), object storage (backup/restore), application deploy (previous-version redeploy) are identified and reachable during the window.

---

## 1. Back up PostgreSQL and object storage; verify restore procedures

- [ ] Take a full PostgreSQL backup (not just a snapshot schedule's next automatic run — an explicit, verified backup taken immediately before this rollout).
- [ ] Take a full object-storage backup/snapshot (or confirm the storage provider's existing versioning/replication satisfies point-in-time restore for the media bucket).
- [ ] **Verify** both restores actually work, on a scratch environment, before proceeding — a backup that has never been restored is not a tested rollback path. Record the restore time for both (informs the acceptable rollback window in step 11).
- [ ] Confirm the migration-ordering plan below (this section) has been reviewed against the actual current production schema state — do not assume the migrations listed here are still pending if some have already shipped since this document was written.

---

## 2. Read-only integrity audit in production; preserve the report

Run (read-only, no writes) against production:

```
pnpm --filter api run db:audit-p5a-tenant-relations
pnpm --filter api run generate:ownership-inventory   # confirms no UNCLASSIFIED model against prod's current schema
```

- [ ] `db:audit-p5a-tenant-relations` reports **0 total issues**. If P5a's triggers/constraints are already live in production (per that section's "Status: done" note), this should already be clean — a non-zero result here means either the constraints aren't actually enforcing in production yet, or new data has violated an invariant since P5a shipped. **Stop and produce a repair report; do not guess ownership automatically** (plan §5.4) if this is non-clean.
- [ ] Explicitly count and classify, per the plan's own instruction:
  - Unowned `Screen` rows — expect 0 (structurally impossible since `Screen.organizationId NOT NULL`, P5a schema task 4). A non-zero count here would indicate a schema drift between this document's assumptions and actual production state — stop.
  - Cross-org `AuditLog` actors — expect 0 (P5a's `auditlog_actor_same_org` trigger + the 2026-09-05 backfill migrated all historical cross-org rows to `PlatformAuditLog`).
  - Duplicate `DesignDraft.documentId` under the `(organizationId, documentId)` scope — expect 0 (structurally impossible since the unique constraint is already scoped, not global).
  - Every composite-relation trigger target listed in `db:audit-p5a-tenant-relations`'s own output.
- [ ] Preserve the full audit output (both commands' stdout) as an artifact attached to this rollout's record — this is the "before" baseline step 4 and step 10 compare against.

**If this step is clean** (expected, since P5a is already marked done and deployed): steps 3–5 below are historical record of what already shipped, not new work for *this* rollout. Confirm via `git log`/deployment history that the P5a migrations are actually applied to the target production database before skipping ahead to step 6.

---

## 3–5. Schema migration ordering (reference — confirm against actual production state before assuming any is still pending)

If any of P5a's migrations are **not yet applied** to the production target (verify via `prisma migrate status` against production before assuming otherwise), apply in this order — do not reorder:

1. **Additive schema fields only** — `Screen.organizationId` added nullable first if not already present, `PlatformAuditLog.targetOrganizationId` added nullable, `DesignDraft`'s new compound-unique index added *alongside* (not replacing) the old global-unique constraint. No composite FK triggers yet. No column is dropped or made `NOT NULL` in this migration.
2. **Backfill.** Run the backfill scripts for each additive field (screen ownership resolution, `PlatformAuditLog` migration of historical cross-org `AuditLog` rows, etc.) as their own deploy step, not inside the schema migration itself. Re-run step 2's audit after backfill; it must be clean before proceeding.
3. **Enable composite constraints in a separate, controlled migration** — the 15 Postgres triggers (`prisma/migrations/20260906215405_p5a_composite_tenant_fks/migration.sql`) and the `NOT NULL`/scoped-unique tightening, only after step above is confirmed clean. This migration is the one that actually starts *rejecting* cross-tenant writes — treat it as the point of no easy return (rollback here means either reverting the migration or fixing the offending data, not just redeploying old app code, since old app code plus new constraints could now fail on paths that used to silently succeed).

Since P5a's own status line already says these are deployed (2026-09-06), this section is preserved for reference/repeatability (e.g. a second environment, a rebuild from backup) rather than as pending work — do not re-run these migrations against a production database that already has them.

---

## 6. Deploy authenticated media delivery, both URL formats understood internally

- [ ] Confirm the current deployed `MediaController` already understands both the new token-authorized routes (`GET /media/assets/:id`, etc.) and the legacy unauthenticated routes (`GET /media/:orgId/assets/:filename`) simultaneously — per P4's "Status: done" note, this is already the deployed state, not a pending change.
- [ ] No action needed here unless this rollout includes a *new* P4-touching change since that status was recorded — re-verify against current `media.controller.ts` before assuming this step is a no-op.

---

## 7. Update dashboard and players; confirm offline caching; observe manifest-refresh telemetry

- [ ] Confirm the dashboard build being deployed only ever requests media through the new signed-URL routes (`StorageService.assetUrl()` etc.) — verified by this session's P4 status note ("all ~20 `storage.publicUrl` call sites migrated").
- [ ] **Player manifest-refresh gate:** before disabling the legacy routes in step 8, confirm the active player fleet has refreshed its manifest at least once since the authenticated-media deploy. Concretely:
  - Every legacy-route hit is logged (`media.controller.ts`'s `serveAsset`/`serveScreenshot` — "Legacy unauthenticated media route hit" warning). Monitor this log volume as the actual fleet-refresh signal, **not a fixed calendar wait** (the plan explicitly rejects a fixed waiting period — "do not use a defined time period").
  - A player refreshes its manifest on its own heartbeat/sync cycle (`apps/player`) and on an explicit "Refresh now" dashboard action. There is currently no dedicated manifest-refresh-percentage dashboard metric — the legacy-route-hit log volume trending to (and staying at) zero across a full observed fleet heartbeat cycle is the available proxy signal until one is built. If a precise per-device manifest-version metric is required before step 8, that is a **product decision to make before this step**, not something to infer from logs alone — flag it rather than guessing a threshold.
- [ ] Confirm offline player caching still functions across this deploy (a player that's been offline through the transition should still play its last-cached manifest, and should re-authenticate media URLs correctly once it reconnects) — this needs an actual offline/reconnect test against a real or staged player, not just a code read.

---

## 8. Disable old public media routes — only after the fleet-refresh threshold, never a fixed wait

- [ ] **Gate:** legacy-route-hit log volume (step 7) has dropped to zero and stayed at zero across at least one full fleet heartbeat cycle for every active tenant, confirmed by whoever owns fleet monitoring — not a calendar date.
- [ ] Preserve a controlled rollback path for any offline player that reconnects later with a stale (legacy-shaped) manifest URL still cached — do not remove the legacy route handlers' code entirely in the same deploy that stops advertising new legacy URLs; keep them capable of serving a request for one further release cycle in case a long-offline device reconnects, then remove in a follow-up deploy once that risk window has also passed.
- [ ] This is the first step in this runbook that removes a request path a real (if stale) client could still be depending on — treat it as higher-risk than steps 1–7 and confirm explicit sign-off immediately before executing.

---

## 9. P5b (RLS) — not applicable to this rollout

**Status: not selected for this release.** Per the plan's own P5b section: *"P5b does not block the first isolation release... Promote P5b to a release requirement only when a documented compliance or threat-model decision requires RLS."* No such decision has been recorded. This step is therefore **skipped, not deferred-with-a-TODO** — there are no database roles, `SET LOCAL`/`set_config` transaction boundaries, or RLS policies in this codebase to stage or enforce. If a future compliance/threat-model decision selects P5b, it is a separate architecture project (its own design document, per that section's explicit requirement) with its own rollout runbook — this document does not attempt to anticipate its shape.

---

## 10. Two-tenant smoke tests on production, using dedicated test tenants

Run the following against **production**, using two dedicated, clearly-labeled test tenants created for this purpose (never real customer tenants) — this mirrors the automated e2e IDOR matrix (`apps/api/test/idor/*.e2e-spec.ts`) but against the real production database/storage/CDN, which the automated suite (run against a dev/CI database) cannot itself verify:

- [ ] Create two production test tenants (e.g. `Smoke Test A`, `Smoke Test B`), one user each.
- [ ] Tenant A cannot `GET`/update/delete Tenant B's screen, asset, playlist, layout, theme, design by id — all `404`.
- [ ] Tenant B can read a real platform-shared asset and a `GLOBAL` template; cannot mutate the shared library source (`403`).
- [ ] A production Super Admin account can perform one explicit `/admin` operation (e.g. tenant status read, not a destructive mutation against a real tenant) and it is audited in `PlatformAuditLog`.
- [ ] A media URL minted for Tenant A's asset is rejected (401) if its resource id is swapped for Tenant B's — spot-check by hand against one real asset, mirroring `media-download-authz.e2e-spec.ts`.
- [ ] A WebSocket connection as Tenant A's dashboard user does not receive a broadcast scoped to Tenant B's org room — spot-check with two real browser sessions or a scripted socket.io-client check against production.
- [ ] **Clean up both test tenants and all their data after the smoke test completes** — do not leave permanent test fixtures in the production database.

---

## 11. Monitoring during and after rollout

Monitor for the duration of the rollout window and for a follow-up period agreed with fleet/ops owners:

- [ ] `403`/`404` rate — a spike immediately after a step above may indicate a real client (dashboard build, player fleet) still depending on a path this rollout changed, not just expected IDOR rejections.
- [ ] Auth-version-mismatch (`401`) rate — unexpected spikes could indicate a session-revocation regression, not just normal logout/role-change activity.
- [ ] Media delivery failure rate (`media.controller.ts`'s `getObject` 404s / `MediaTokenService` verification failures).
- [ ] WebSocket disconnect rate and `auth-invalidated` event volume (`ScreenGateway`).
- [ ] Pairing abuse/expiry metrics (`PairingSession` creation rate, rate-limit rejection log volume from `PlayerService`).
- [ ] Manifest-refresh telemetry (the legacy-media-route-hit log volume from step 7/8).
- [ ] Storage reconciliation alerts — **not currently available.** No reconciliation job exists yet (P4 task 9 was deliberately deferred — see `docs/tenant_isolation_and_platform_admin_plan.md` §P4 and the companion P9 checklist's item 6). This bullet is listed here because the plan's own rollout sequence names it, but there is nothing to monitor until that job is built; report storage-layer drift manually via ad hoc bucket/DB cross-checks if needed during this window, not via an automated alert.

---

## Rollback principles (apply to every step above)

- **Rollback must revert application behavior without dropping newly added columns or deleting backfilled data.** A rollback redeploys the previous application version; it does not run a down-migration that destroys P5a's additive columns or backfilled `PlatformAuditLog`/`organizationId` data, even if that data is temporarily unused by the reverted app version.
- **Never roll back by disabling ownership checks globally.** If a specific check is misbehaving (e.g. a trigger rejecting a legitimate write due to a data shape this runbook didn't anticipate), fix that specific check or repair the offending data — do not disable `assertOwns`, a guard, or a trigger wholesale as a shortcut.
- Each step above that changes externally-visible behavior (6, 7, 8, 9-if-ever-selected) should have its own specific rollback note at execution time, informed by what actually shipped in that step — this document defines the principles and gates, not a single generic rollback script, since the actual rollback action depends on which step is being reverted.

---

## What this runbook does NOT cover

- Executing any step above. This document is preparation only, per the explicit instruction under which it was written.
- A real Stripe/subscription billing backend (P9's own scope note: "only P9/real billing backend left" — billing is separately out of scope for tenant isolation).
- Object-storage reconciliation tooling (doesn't exist yet — P4 task 9, deliberately deferred).
- P5b (RLS) staged enforcement (not selected for this release — see step 9 above).
