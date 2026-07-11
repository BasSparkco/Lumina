# Phase 5 (Frontend track) — Multi-tenant teams, RBAC & operations

> Part of [Roadmap.md](./Roadmap.md) Phase 5. This file covers the **dashboard UI** side of
> Phase 5, owned by the frontend track. API/worker/Prisma work lives in
> [Roadmap-Phase5-Backend.md](./Roadmap-Phase5-Backend.md). Log daily progress in
> [status-frontend.md](./status-frontend.md).

Legend: ☐ todo · ◐ in progress · ☑ done

---

## Before the backend contract lands

You don't have to block on the backend track. Build these screens against mocked responses first
(see "Shared contract" in the backend file for the exact shapes to mock), then swap in real API
calls once endpoints are live:

- ☐ Mock `GET /v1/org/members`, permission check hook, `ScreenGroup`, `ProofOfPlayLog`,
  `AuditLog` shapes locally (e.g. `packages/types` or a local fixtures file) matching what the
  backend track publishes

---

## Teams & RBAC UI

- ☑ Org "Members" page: list members + roles, invite-by-email form, role dropdown, remove member
- ☑ Accept-invite page/flow (token from email link)
- ☑ Role-aware nav/UI — hide/disable actions the current user's role can't perform (billing,
  member management for non-admins; read-only mode for viewers)
- ☑ Client-side guard for editor/viewer routes (defense in depth — backend is the real enforcement)

## Content approval workflow UI

- ☑ Playlist builder: "Submit for review" action (editor role) replacing direct publish
- ☑ Admin/owner "Pending approvals" view — list submitted playlists, approve/reject with comment
- ☑ Status badge on playlists (Draft / Pending / Approved / Rejected) throughout dashboard

## Audit log UI

- ☑ Org "Audit log" page — filterable table (resource type, date range, user), paginated

**Exit criteria (frontend):** a team with mixed roles can invite/manage members, submit/approve
content changes, and review an audit trail entirely through the dashboard.

---

## Screen groups & tags UI

- ☑ Screens page: create/edit groups (or tag screens), filter screen list by group/tag
- ☑ Bulk actions: "Publish to group" button triggering the group publish endpoint

## Proof-of-play reporting UI

- ☑ Reports page: proof-of-play table filtered by screen + date range
- ☑ Export button (CSV download via the export endpoint)
- ☑ Simple charts (plays per day/screen) — nice-to-have if time allows

## Fleet monitoring dashboard UI

- ☑ Fleet overview page: uptime %, last-seen, offline alerts across all screens at a glance
- ☑ Alert indicators (badge/toast) for screens offline > threshold

## Billing/subscriptions UI

- ☑ Org "Billing" page: current plan, screen usage vs. limit, upgrade/checkout button (Stripe
  Checkout redirect)
- ☑ Screen-limit-reached messaging when pairing blocked by plan

**Exit criteria (frontend):** groups/tags, proof-of-play, fleet health, and billing are all
manageable from the dashboard without needing direct API calls.

---

## Notes for coordinating with the backend track

- If a mocked shape turns out to differ from what shiz