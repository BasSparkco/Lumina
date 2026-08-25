# ADR: Spark Screens Designer — Architecture Contract (V1, Phase 0)

## Context

`designer.md` (repo root) specifies a full rebuild of Lumina's signage design tooling: a
Fabric.js-based canvas editor producing a versioned, Lumina-owned Design JSON (Scenes → Elements,
with animations, dynamic variables, RTL support), backing a future Template system where a
Super Admin curates reusable designs assignable to specific tenants.

This is not a greenfield effort. `apps/dashboard/src/app/[locale]/(app)/designer/` already
contains two live, actively-maintained editors: `LayoutCanvasPanel.tsx` (Fabric.js 7.4.0,
zone-based screen splitting) and `ThemeCanvasPanel.tsx` (a separate DOM/react-rnd
implementation, no Fabric, full-screen presentational elements for kiosk/prayer-time content).
Both already treat a plain data model (`ZoneInput[]`, `ThemeElement[]`) as the source of truth
and rebuild their rendering objects from it on every change — the "never persist raw canvas
serialization" rule below is already the working pattern for Layouts, not a new constraint.

This ADR records the decisions made in Phase 0 (Discovery & Contract) that later phases inherit
without re-litigating.

## Decision

Adopt Fabric.js 7.4.0 (already a dashboard dependency, already proven in `LayoutCanvasPanel.tsx`)
as the **editor-only** rendering engine for the new `designer2` module, behind a
`FabricCanvasAdapter`. Lumina owns a versioned `DesignDocument` schema
(`@lumina/design-schema`, Zod) as the sole persistence, API, and Player contract. Raw
`canvas.toJSON()` is never the persisted business record.

## The Fabric-hidden-behind-adapter rule

Per designer.md §4.1/§4.2: Fabric.js owns canvas rendering, object selection, transform
controls, drag/resize/rotate, zoom/pan, and canvas events — nothing else. It has zero business
logic: no tenant permissions, no Template permissions, no persistence, no version history, no
timeline logic, no Player contract, no dynamic variable resolution. All application code talks
to the `CanvasAdapter` interface; only `features/designer2/canvas/*` may import `fabric`
directly.

## Schema versioning strategy

Every `DesignDocument` carries `schemaVersion: 1` (a Zod literal today). A future breaking
change bumps the literal and ships a documented migration function
(`migrateDesignV1ToV2()`-style, per designer.md §18.4). No migration infrastructure exists yet —
this is a reserved convention, not a component to build until a schema break actually happens.

## Naming decision

- **`Asset`** (existing Prisma model) — unchanged. Already means uploaded media (image/video/
  document), matching designer.md §9's `MediaAsset` concept precisely. No change needed.
- **`DesignAsset`** (new, not yet a Prisma model — Phase 5) — a customer-owned, editable design
  created from scratch or cloned from a Template.
- **`Template`** (new, not yet a Prisma model — Phase 5) — a Super-Admin-owned, reusable
  `DesignDocument`, cloned into a customer's own `DesignAsset` on use; never referenced live.

Confirmed via repo-wide search: no existing `DesignAsset` symbol to collide with.

## Relationship to existing Layout and Theme models

**Decision: keep `Layout` and `Theme` alongside, unmigrated, for the foreseeable future.** They
solve different problems than the new Scene/Element Designer — `Layout` is zone-based screen
splitting for multi-zone signage, `Theme` is a full-screen presentational template for kiosk
attract screens and prayer-time slides — and both have live editors in active use by real
customers today. Nothing in Phase 0 or Phase 1 requires touching either.

A future consolidation (e.g., re-expressing a `Theme`'s `elements`/`palette`/`typography` JSON
as a single-scene `DesignDocument`) is plausible, but is an explicit **non-goal** until the new
Designer reaches feature parity with Theme's actual use cases. Revisit this ADR if/when that
parity work is scoped — do not force it now.

## Super Admin cross-reference

A cross-tenant `User.isSuperAdmin` flag and `SuperAdminGuard` now exist (see the auth module),
built ahead of schedule at the user's request. No endpoint currently checks it — that's
intentional scaffolding ahead of Phase 5's actual Template admin endpoints.

Note for Phase 5: the existing nullable-`organizationId` pattern (`Theme.organizationId: null` =
system preset visible to every org, same for shared library `Asset` rows) cleanly expresses
`GLOBAL`-vs-tenant-owned, but does **not** express `SELECTED_TENANTS`/`TENANT_GROUP` visibility
(designer.md §10.2). `design_templates` will likely need nullable-`organizationId` for the
authoring side (always null — Templates are platform-owned) **plus** a real
`design_template_tenants` join table for selective assignment. Flagging this now so Phase 5
isn't blindsided; not fully designed here.

## Amendments (2026-08-25, post Phase 2 retrospective)

A Phase 1/2 retrospective surfaced four architecture-level adjustments, all reflected inline in
`designer.md` (each marked with a dated "Amendment" note at its section):

1. **Element locking is capability-based, not a single boolean.** `BaseElement.locked: boolean`
   (§6) is replaced by `selectable`/`movable`/`resizable`/`deletable` flags, since a plain boolean
   cannot express designer.md §7's own examples (e.g. a logo placeholder that's selectable/
   content-editable but position-locked). `TemplateLayerPolicy` (§7) narrows to just
   `styleEditable`/`contentEditable` — the two axes that are genuinely Template-specific; the rest
   now live on every element, not just Template-managed ones.
2. **Properties Panel edits go through `CanvasAdapter.updateElement()` for live feedback, and
   commit to the store only on blur/debounce** (§8) — never a full document mutation per
   keystroke. Phase 2's "clear and rebuild every element on any `document` change" canvas
   strategy is fine for discrete actions (add/delete/duplicate/reorder) but would visibly stutter
   under live numeric-field editing if used for that too.
3. **RTL text rendering is a planned hybrid** (Phase 8 amendment): Fabric's `Textbox` has no real
   bidi shaping, unlike `ThemeCanvasPanel`'s existing DOM-based text. Decision: `TextElement`
   keeps Fabric for position/selection/transform, but glyph rendering is a synced DOM overlay —
   decide the sync mechanism before Phase 8 starts, not during it.
4. **`packages/design-schema`'s `MediaReference` flattened** to a plain `assetId` (§9), matching
   what Phase 2 actually implemented and resolving an inconsistency in the original draft (§9's
   nested shape vs. §18.2's own flat example).

Also simplified: §4.2's suggested `canvas/` file split (`FabricSerializationAdapter.ts`/
`FabricSelectionAdapter.ts`/`FabricGuidelines.ts` as separate mandatory files) proved
over-granular — selection and extraction live in the existing `FabricEventBridge.ts`/
`FabricCanvasAdapter.ts` pair; a guidelines file is added only when Phase 3's snapping work needs
it, reusing `apps/dashboard/src/lib/canvasSnap.ts`.

## Phase 0 exit criteria — confirmed

- **"Design JSON can represent all V1 requested content"**: `@lumina/design-schema` defines
  Text, Image, Shape, Video, and QR elements (designer.md §6), enter/emphasis/exit animations
  (§13), dynamic field definitions and bindings (§17.2), and Template layer policy (§7). All
  five element types round-trip through `DesignElementSchema` (verified against designer.md
  §18.2's own example document).
- **"No raw Fabric JSON is required by Player"**: `player-contract.ts`'s `ResolvedDesignPayload`
  contract never mentions Fabric, and is defined independently of the editor's internal
  representation.
