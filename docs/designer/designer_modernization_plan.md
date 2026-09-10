# Designer2 modernization: architecture audit and implementation plan

Reviewed: 2026-09-09. Scope: the current working tree, including the recent inline-text and unified-layer changes. This is not an audit of a deployed build.

## Status and decision

- **M0 — architecture audit: complete at source-review level.** Existing adapter regression tests were run; full application performance measurements remain M1/M8 work.
- **M1 — persistent synchronization: implemented (2026-09-09).** See the implementation record below.
- **M2 — direct media insertion: implemented (2026-09-09).**
- **M3 — coordinate/rotation contract: substantially implemented (2026-09-09).** The x/y-rotation boundary, multi-select batching, text corner-scale normalization, skew/flip decision, and zoom-invariance tests are done; production's designs were checked directly (8 designs, 22 elements, 0 templates) and contain zero rotated elements, so the legacy-frame normalization task is currently moot — nothing to migrate. Only DPR/retina pixel-rendering tests (need a real browser canvas rasterizer, not achievable in jsdom) remain open. See the implementation records below.
- **M4 — layers/selection: complete (2026-09-10).** Two confirmed bugs fixed (selection-delta reporting, hidden/locked canvas selection), server-side Template policy enforcement in `apps/api` (deployed), and Layers-panel action discoverability (rename/visibility/lock/duplicate/delete/reorder/keyboard DnD) all shipped.
- **M5–M8: planned.**
- **Approach A, with the synchronization foundation refactored first.** Keep Fabric, the adapter boundary, Zustand, Lumina Design JSON, tenant Asset storage, published Template snapshots, and the DOM Player. Replace whole-scene reconstruction during ordinary editing. Do not replace the editor framework or persistence model.
- The initial M0 review stopped at the milestone plan as requested by [improve designer2.md §28](../../improve%20designer2.md). The user subsequently authorized M1 and M2, then M3. Their implementation records are below; the rest of M3 is next, with permission constraints carried into every command from the outset.
- `status.md` is a frozen archive; this document tracks modernization instead. Existing unrelated working-tree changes are outside this task.

## Evidence map

Paths below are relative to the repository root. Line references describe the reviewed working tree and may move during implementation.

| Area | Code inspected | Finding |
| --- | --- | --- |
| Route and session | `apps/dashboard/src/app/[locale]/(app)/designer2/page.tsx`, source-loading effect and save callbacks | Client-only dynamic shell; initial source fetch; first-save URL replacement has a loaded-key guard. Async source fetches have no stale-result guard. |
| Canvas lifetime | `apps/dashboard/src/features/designer2/components/CanvasViewport.tsx:203` | One adapter per mounted viewport, listeners bind once through latest refs; cleanup disposes it. Strict Mode creates a fresh DOM canvas per mount. |
| Scene synchronization | `CanvasViewport.tsx:245` | Effect depends on whole document, scene ID, assets and organization settings; calls `loadScene`, then fit and selection restoration. |
| Reconstruction | `apps/dashboard/src/features/designer2/canvas/FabricCanvasAdapter.ts:178` | `loadScene` clears everything and sequentially creates every object; clear removes text/video DOM and cancels animations. No load generation/cancellation guard. |
| Event boundaries | `apps/dashboard/src/features/designer2/canvas/FabricEventBridge.ts:45` | Single-object geometry commits on `object:modified`; moving updates local Fabric geometry and React guide state. Group modification is ignored without `elementId`. |
| Media insertion | `DesignerShell.tsx`, sidebar insertion callbacks; `lib/defaultElements.ts` | Image creates 400×300; video creates 640×360, both without selected media. |
| Image representation | `canvas/FabricObjectFactory.ts:136`, `:190` | Natural image fitted inside a fixed-size Group; crop/clip and adjustments applied there. Contain fit can leave empty space inside the selectable Group. |
| Video/text representation | `FabricCanvasAdapter.ts:285`, `:333`, `:378`, `:411`; `canvas/LayeredCanvas.ts` | Native textarea editing; one ordered DOM stack interleaving text/video with painted canvas runs; DOM geometry derives from Fabric matrix. |
| Properties | `components/PropertiesPanel.tsx:280`, `:303`, `:418`; `hooks/useLiveField.ts` | Numeric preview is local, commit on blur. Color commits each change. Adapter maps only geometry, opacity, visibility and font size. |
| State/history | `state/designer.store.ts`; `state/history.store.ts`; `apps/dashboard/src/hooks/useEditorHistory.ts` | JSON and ephemeral state are separate fields. Undo restores through initial-load action, resetting scene/selection. Full-document history has no cap/no-op suppression. |
| Layers | `components/ObjectsPanel.tsx`; `apps/dashboard/src/components/LayersPanel.tsx`; store reorder actions | Panel and canvas sort the same zIndex values. Panel currently exposes selection and drag reorder; other actions are scattered in properties/context menu. |
| Scenes/preview | `components/SceneStrip.tsx`; `DesignerShell.tsx` preview loop | Scene CRUD/duration/reorder exist. No element-track timeline. Thumbnails capture canvas bitmap, excluding native text/video/background. Preview cycles the editing adapter. |
| Persistence | `hooks/useAutosave.ts`; `apps/api/src/modules/designs/designs.service.ts` | Draft debounce is 500 ms local / 3 seconds backend. Manual versions separate. Draft writes have no revision token; manual revision comparison precedes the transaction. |
| Contracts and permissions | `packages/design-schema/src/*`; `apps/api/src/modules/templates/templates.service.ts`; designs service | Independent v1 JSON, asset ownership checks, immutable authorized Template cloning. Layer policy fields exist but normal design update does not compare edits against source Template policy. |
| Player | `apps/player/src/components/DesignRenderer.tsx`; `packages/design-schema/src/runtime/*` | DOM runtime sorts zIndex, uses CSS center-origin rotation, shares variable/animation definitions. It does not deserialize Fabric JSON. |

Additional reviewed components: top bar, sidebar, inspector, variables, versions, Template gallery, shared ImagePicker/VideoPicker, shared snapping and history, asset metadata/API contracts, original `designer.md` architecture/performance amendments and `docs/adr/designer-architecture.md`.

## Required review answers

### 1. Why does editing visibly refresh?

The direct path is:

```text
object:modified / property commit / reorder / document rename
→ store produces a new document reference
→ CanvasViewport scene effect
→ adapter.loadScene → clear → recreate every object and video
→ fitToViewport → restore selection
```

This explains repainting, image reload/decode work, video restart and zoom jumps without a browser navigation. Asset-list/settings changes also enter this path. Sequential asynchronous creation can expose a partially rebuilt scene. Overlapping loads can add stale objects after a newer clear because neither the effect nor adapter protects against stale completion. This is source evidence, not a measured count of production refreshes.

### 2. Is Fabric recreated or reloaded?

The **Canvas instance normally persists**. The **scene objects are rebuilt** after every document change. `loadFromJSON()` is not used here: the destructive equivalent is the custom clear/create loop. Mount cleanup is separate from ordinary updates. ResizeObserver also reconnects on `[document]` and fits the viewport, compounding zoom resets.

### 3. Is React state updated too aggressively?

Not every pointer move writes the design. Single-object movement commits at release, which is worth preserving. However, each moving event calls `onGuidesChange` with new arrays, causing viewport renders. Broad whole-document subscriptions refresh shell/panels for unrelated metadata edits. Color input changes are separate document/history commits. Selection updates are not equality-filtered in the store. Fix these separately from the more serious reconstruction issue.

### 4. Why are image/video wrappers too large?

Insertion chooses a generic rectangle before it knows the media. Image replacement changes only `assetId`, keeping 400×300 geometry. `positionImageInBox` then contains the natural image inside that box, and `FixedLayout` deliberately keeps controls around the larger box. Video starts at 640×360 regardless of source ratio; its default cover fit crops mismatched media, while contain can letterbox it. Asset records already expose nullable width/height; the insertion flow does not use them.

A fixed crop frame remains legitimate for an existing authored design. The error is treating every new media insertion as a frame before selecting its content.

### 5. Why does video rotation diverge?

The earlier simple left/top plus CSS rotation approach has already been replaced in this working tree: `applyOverlayGeometry` now uses `calcTransformMatrix()` and local-center translation for text and video. Do not reintroduce that old fix or claim the old overlay bug remains unchanged.

There is still a **different coordinate-contract mismatch** to resolve: the factory uses Fabric `originX/Y: left/top`, and extraction persists `obj.left/top` directly; Player places an unrotated rectangle at JSON x/y and rotates around its center (`DesignRenderer.tsx:62`). At nonzero rotation, Fabric's transformed top-left anchor is not the Player's unrotated-box top-left. This affects saved/preview parity beyond video. Stroke-inclusive `getScaledWidth/Height()` adds another round-trip risk. The matrix overlay itself needs rotated, scaled, grouped and high-DPI browser tests before declaring the entire transform chain correct.

### 6. Is video a DOM overlay?

Yes: a transparent Fabric Rect handles interaction; an HTML video handles decoding/playback. Keep the hybrid for now. Native browser text is also deliberate for Arabic/bidi. The new layered renderer overrides `_renderObjects` to interleave native media with canvas runs while Fabric retains hit testing/controls. This is a Fabric-specific integration seam requiring regression coverage and version pinning. It is not a reason by itself to replace Fabric.

### 7. Is Design JSON independent enough?

Yes. Versioned Zod documents contain scenes, elements, assets, animation and bindings; Fabric instances and serialized Fabric objects are absent. Preserve this. Geometry semantics need clarification and potentially a versioned migration; independence alone does not guarantee editor/Player parity.

### 8. Do Layers and canvas have the same authority?

Yes: `scene.elements[].zIndex`; panel descending, canvas ascending, Player ascending. The recent unified stack fixes the old text/video bands. But UI reordering still commits JSON and rebuilds the scene rather than moving persistent objects. Selection has two additional defects: `selection:updated` uses only `e.selected`, whereas installed Fabric 7.4.0 emits newly added objects there; and group `object:modified` lacks an elementId so no member transforms are committed. `selectElements` also does not filter hidden/non-selectable targets requested by the panel.

### 9. Is autosave interfering?

Autosave does not load the scene, navigate, or write a design per pointer event. Its success changes only status. Preserve that separation. Problems remain:

- Draft responses can complete out of order; an older response can report “saved” while newer edits are pending.
- A pending draft can arrive after manual Save deletes drafts and recreate stale recovery content.
- Manual Save checks revision before an unconditional ID-only update; this is not an atomic compare-and-swap. Version-number allocation also needs concurrent-save coverage.
- Local recovery keys contain only document ID; validate drafts and scope them to tenant/user/session.
- Template cloning currently copies the source document ID unchanged (`createFromTemplate`). Multiple clones from the same Template can therefore share a draft identity within one tenant. Give new clones distinct document identity while preserving their source Template/version linkage.

These are verified code paths/race risks, not a claim that concurrent data loss was reproduced during this audit.

### 10. What should be preserved or refactored?

Preserve the business model, tenant Asset APIs and processing pipeline, Template authorization/published snapshots, JSON schema ownership, scene model, adapter isolation, final-gesture commits, native RTL, existing DnD and snapping utilities, and DOM Player.

Refactor synchronization/cancellation first; then media insertion, geometry conversion, complete multi-selection, typed property updates, policy-aware commands, history restoration, draft scheduling/concurrency and preview fidelity. Do not add a new editor framework or duplicate media storage.

## Other findings that affect implementation order

- **Permission enforcement:** property capability toggles and alignment can bypass intended locks; generic store update accepts any patch. Text editing checks `editable/selectable`, not source Template content policy. Backend design update validates JSON/assets but does not enforce immutable source-layer restrictions. Enforce policy through commands and backend comparisons, not disabled buttons alone; never trust client-supplied policy flags as authority.
- **Live property gaps:** stroke width, corner radius and volume call adapter live update but are not mapped. Changing Group width/height alone does not refit the image child or clip. Textarea/name/defaultValue fields can remain stale when the same element changes through undo or inline editing.
- **Text transforms:** scaling a Textbox changes rendered font size through scale, but final geometry extraction does not persist that font scaling. Normalize text size/reflow intentionally to prevent release-time appearance changes.
- **Zoom controls:** top-bar +/- changes store zoom; the viewport has no corresponding store-zoom-to-adapter effect. Wheel zoom calls the adapter directly. Unify this command path and distinguish manual zoom from fit mode.
- **Video playback:** any visible paused autoplay video is played again on every render; an end-offset pause can therefore restart. Maintain explicit playback/trim state and avoid repeated play attempts after autoplay rejection.
- **Snapping:** shared center/edge math exists, but uses unrotated bounds, includes hidden objects, skips multi-selection, and has a fixed design-pixel tolerance. Improve the inputs and render guides outside React's frame path.
- **Preview:** only scene color backgrounds render in Designer; Player also handles image/video backgrounds. Native text/video are absent from canvas thumbnails. Entry animations can still be manipulated while editing; preview blocks pointer events but shell keyboard mutations remain active.
- **Resource budget:** the layered renderer allocates a viewport-sized canvas for each contiguous painted run separated by native layers. Test worst-case alternating text/image/video at DPR 2; retain grouping and impose evidence-based memory limits before optimizing further.

## Dependency and reference review

The lockfile/current dashboard uses Fabric 7.4.0, React/React DOM 19.2.8, Next 16.2.11, Zustand 5.0.14, TanStack Query 5.101.4, DnD Kit core 6.3.1/sortable 10.0.0, qrcode 1.5.4, and Vitest 5.0.0. These are installed project versions, not claims about the latest releases. No new runtime dependency is justified by this review. Use the repository's existing tooling; any later addition needs explicit bundle/license/maintenance review.

Fabric documents viewport → parent → own transformation composition and full-object matrices. Use the installed version's implementation/tests to define the adapter conversion, rather than copying APIs from a different release. [Fabric transformation documentation](https://fabricjs.com/docs/transformations/).

OptiSigns documents device/Asset image selection and distinct text side-resize versus corner font scaling. Adopt those interaction concepts as UX references, with Lumina's own implementation and design system. No proprietary code or branding is proposed. [OptiSigns Designer guide](https://support.optisigns.com/hc/en-us/articles/42087942047379-Getting-Started-with-Designer).

## Target synchronization contract

```text
Lumina document + authorized asset metadata + resolved display bindings
                        ↓
             active-scene reconciliation
                        ↓
       persistent Fabric objects and native media
                        ↑
      local gesture / transient property preview
                        ↓ release / accepted edit
         validated semantic command → one history entry
                        ↓
                canonical JSON update
                        ↓
            debounced, sequenced draft save
```

Reconciliation compares canonical inputs to the last applied projection by stable ID; it is not a second authoritative document. Selection, zoom, pan, editing drafts and playback are ephemeral. Resolution of dynamic display values stays outside Fabric. Inline editing must use authored values or an explicit binding-edit workflow, never silently save a resolved preview string over the authored binding.

## Milestones

Each milestone is a reviewable change set with its own passing checks. No global rewrite and no “complete” status based only on typechecking.

### M0 — Current architecture audit (complete)

- Problem/root cause: behavior and historic amendments conflict with commercial-editor expectations.
- Files: evidence map above, this plan, `designer.md`, architecture ADR.
- Change/tasks: trace all ten questions, identify prior fixes and outstanding risks, define architecture and rollout gates.
- Tests: existing four adapter tests as a baseline; source review of installed Fabric event payloads and transform implementation.
- Acceptance: concrete source references distinguish persistent canvas lifetime from scene reloads; no unmeasured 60fps claims.
- Compatibility: no production or schema edits in this milestone.

### M1 — Persistent canvas synchronization and lifecycle (implemented)

- Problem/root cause: whole-document scene effect, destructive reloads, uncancelled async creation, automatic refit on commits.
- Files: `CanvasViewport.tsx`, `FabricCanvasAdapter.ts`, `FabricObjectFactory.ts`, `LayeredCanvas.ts`, store selectors; focused new reconciliation/lifecycle tests.
- Architecture: `syncScene` updates persistent objects by ID. Full clear is reserved for document/scene identity changes. Separate content, selection, viewport and resource-resolution effects.
- Tasks: diff adds/removes/properties/order; preserve object/DOM identity on geometry/style/reorder; generation tokens plus abort where supported; dispose stale async results; resolve only changed asset resources; preserve playback time; memoize active-scene projections; one mount-level ResizeObserver; explicit fit/manual zoom command path; deduplicate guide changes or draw imperatively.
- Begin with tests proving the current reload, then change the minimum adapter/viewport surface. Type-specific content changes may temporarily replace only the affected object until M5 supplies in-place support; never replace unrelated media.
- Tests: stable canvas/object/video identity through drag, reorder, metadata edits and asset refetch; delayed image decode during rapid scene switching; unmount with pending load; Strict Mode mount cleanup; user zoom survives commit.
- Acceptance: unchanged scene identity causes zero clear/loadScene calls; geometry-only updates create zero objects/media nodes; one changed resource does not refetch unrelated media; stale loads cannot overwrite current scene.
- Compatibility: existing v1 documents and current visual geometry preserved. Update the ADR's always-rebuild amendment when this ships.

### M2 — Direct image/video insertion (implemented)

- Problem/root cause: sidebar inserts generic placeholders before knowing media or natural dimensions.
- Files: `DesignerSidebar.tsx`, `DesignerShell.tsx`, `lib/defaultElements.ts`, shared `ImagePicker.tsx` / `VideoPicker.tsx`, Asset API/types; new focused insertion dialog/controller and geometry helper.
- Architecture: open Upload / Choose from Assets; resolve usable media and dimensions; commit exactly one complete element into the initiating scene. Cancel changes nothing in the design.
- Tasks: reuse tenant-scoped Asset upload/list/get; handle PROCESSING/READY/error states with bounded polling; prefer normalized metadata, then bounded browser metadata probe; release probe resources; cache asset result; preserve aspect ratio and center in visible scene area intersected with canvas; do not upscale small media by default. Do not store blob/signed URLs in JSON. Prevent stale dialogs inserting into another scene/session.
- Tests: 1200×600 and portrait images/videos; missing dimensions; processing failure; cancel; scene switch during upload; aspect-preserving sizing; one insertion/undo step; no canvas placeholder while selecting.
- Acceptance: newly inserted media's selectable geometry equals the rendered rectangular media extent, with no extra contain padding or implicit crop; Upload and Assets work in both languages.
- Compatibility: keep loading asset-less legacy elements with a repair action. Replacement retains existing authored position/frame/crop; direct insertion uses source aspect ratio. Transparent pixels inside a source image are not automatically cropped.

### M3 — Transform and rendering contract (coordinate boundary implemented; remainder planned)

- Problem/root cause: left/top anchoring versus Player center-origin rotation, stroke-inclusive extraction, text scaling, group extraction omissions and media fitting.
- Files: factory, adapter, event bridge, shared design-schema geometry helpers if appropriate, Player renderer, crop helpers; v1 fixture library.
- Architecture: define JSON x/y as the unrotated content-box top-left and rotation about its center, matching Player intent. Convert explicitly at the Fabric boundary. Persist logical content dimensions, not stroke-expanded or rotated AABB dimensions.
- Tasks: reversible encode/decode for every type; batch ActiveSelection members into one transaction in canvas coordinates; normalize scale without changing appearance; text corner resize scales font and side resize reflows; preserve image crop/fit/flip; zero-stroke proxy geometry; compose viewport and group matrices for DOM layers. Define allowed mirroring/skew behavior since v1 has no general skew/flip contract for all types.
- Tests: 0/30/90/180-degree rotations, uniform/nonuniform scales where supported, move and reload cycles, group transforms, crop edges, DPR 1/2, zoom/pan, portrait video. Compare DOM video corners against Fabric content corners and Player screenshots within 1 CSS pixel at tested zoom.
- Acceptance: no drift over repeated save/reload/undo; no release-time font jump; accurate visible media controls; no geometry changes caused by Save.
- Compatibility: first capture existing v1 editor and Player fixtures. Existing rotated v1 intent is ambiguous: do not silently reinterpret it. Preserve published v1 playback; offer an explicit, undoable legacy-frame normalization where intent cannot be inferred. If semantics must change, introduce versioned migration/read compatibility across schema, API and Player before writing the new version.

### M4 — Layers, selection and permission-aware commands

- Problem/root cause: incomplete panel operations, selection event deltas treated as full selection, hidden-target selection, scattered lock enforcement.
- Files: `ObjectsPanel.tsx`, shared `LayersPanel.tsx`, store, event bridge, properties/context menu, designs/template services and tests.
- Architecture: one command/policy boundary for all mutations. Derive permission from trusted source Template/version for customer customizations; keep user position locks distinct from immutable permissions.
- Tasks: row rename, visibility, lock, duplicate/delete and four reorder actions; Shift/Cmd selection with `canvas.getActiveObjects()` synchronization; filter hidden/non-selectable canvas targets while allowing layer management; preserve name-click properties collapse; batch multi-object edits; no-op-safe zIndex operations; keyboard-accessible DnD/context menu. Enforce source content/style/geometry restrictions server-side as well as in UI; never let unlock elevate Template capabilities.
- Tests: full selection after add/remove member; hidden/locked behavior from canvas, panel, keyboard and alignment; reorder immediately without reload; prohibited Template patches rejected even with forged client flags; authorized logo replacement works while its position stays locked.
- Acceptance: all requested layer actions discoverable; canvas and panel show the same selection/order; customer actions cannot bypass source restrictions.
- Compatibility: extend shared LayersPanel through optional props or a Designer2 wrapper so legacy editors retain behavior. Preserve Template source/version links; define non-retroactive policy handling for existing customized designs before enforcing new restrictions.

### M5 — Complete property updates and text editing

- Problem/root cause: partial adapter mapping, defaultValue staleness, generic geometry writes that do not refit child media, color history flooding.
- Files: properties, `useLiveField.ts`, adapter/factory update helpers, inline textarea, variable resolution.
- Architecture: typed per-element preview/apply functions; begin/preview/commit/cancel edit session with canonical before/after values. Projected bindings are read-only display data unless explicitly edited.
- Tasks: handle geometry/font/color/stroke/radius/fit/crop/filters/video volume/playback without scene reload; controlled drafts refresh on external changes when not editing; commit only changed valid values; Escape rollback; safe blur/selection/undo interaction; permissions for all paths; wait for fonts before final text measurement.
- Tests: all listed properties update live; undo refreshes same-element fields; no-op blur creates no history; continuous color drag is one commit; inline Arabic/mixed bidi/multiline; bound text does not overwrite its source; replacement preserves crop frame and video identity when resource unchanged.
- Acceptance: preview and committed appearance match; one meaningful history action per interaction; unrelated objects retain identity.
- Compatibility: reuse existing fields and adjustment contracts. Approximate Fabric filters versus exact Player filters require documented parity tests, not silently dropping stored values.

### M6 — History, save and recovery correctness

- Problem/root cause: undo uses initial load action, unrestricted snapshot count, draft races, clone document-ID reuse and non-atomic manual revision checks.
- Files: designer/history stores, `useEditorHistory.ts` (avoid legacy regression), autosave, shell/page save paths, designs service/schema as required, recovery tests.
- Architecture: distinct initial-load and restore-snapshot commands; retain active scene/selection when IDs still exist. Bounded semantic transactions. Per-session ordered draft scheduler and atomic server concurrency protection.
- Tasks: cap history by measured budget (start with 100 actions); skip equal snapshots; batch multi-transform; preserve zoom/pan on undo; flush accepted property/text edits before Save; serialize saves, reject stale acknowledgements, cancel obsolete timers; coordinate manual save/draft deletion; atomic revision update and version allocation; handle offline retry; validate/scoped local recovery; unique document IDs for new Template clones.
- Tests: drag=one history action, undo on second scene stays there, restore/deleted-selection fallback, rapid consecutive saves, delayed draft after manual save, two simultaneous revisions, stale recovery JSON, tenant switch, two clones of one Template.
- Acceptance: saving never reconstructs canvas or resets selection/zoom/video; stale writes cannot overwrite newer acknowledged state; versions allocated safely; recovery applies only to the correct document/session.
- Compatibility: preserve manual DesignAsset versions and separate draft storage. Draft identity/concurrency schema changes need database migration and a safe legacy recovery path; do not indiscriminately re-ID saved designs.

### M7 — Editing UX, snapping and preview

- Problem/root cause: missing nudge/save shortcuts, viewport guide rerenders, partial preview/background/video semantics and hardcoded labels.
- Files: hotkeys, shell/top bar, canvas guides, SceneStrip, video playback helpers, locale messages, Player/preview components where reusable.
- Architecture: scoped editor shortcuts and shared playback contracts; editing gestures isolated from animation preview. DOM guides updated imperatively only when needed.
- Tasks: arrows 1 px, Shift+arrows 10 px, Cmd/Ctrl+S, existing copy/paste/duplicate/undo; ignore editable targets/composition; block mutations during preview; screen-pixel snap tolerance and rotated visible bounds; exclude hidden targets; preserve pan/manual zoom when panels open. Correct clipped video looping/end pause and scene teardown. Render image/video backgrounds and complete thumbnails via a deliberate DOM/Player-compatible path. Keep existing scene timeline; don't add an unrequested keyframe system.
- Tests: shortcuts while typing/IME, preview keyboard guard, zoom-aware snapping, group alignment, trim loop/stop, muted/autoplay rejection, RTL focus/menu placement, scene duration and return position, thumbnails include text/media/background without controls.
- Acceptance: smooth and predictable manipulation, matching preview and Player composition, usable keyboard/focus behavior, no accidental browser save/delete during editor commands.
- Compatibility: preserve scene timing, animation schema, QR bindings and existing timeline semantics. No new persisted UI state.

### M8 — Performance and release hardening

- Problem/root cause: current unit tests cannot establish browser geometry, resource use, production smoothness or full business-flow regression.
- Files: focused dashboard/browser/API/Player tests and fixtures, development-only metrics module if needed, this plan/ADR.
- Architecture/tasks: development-guarded counters for canvas init/clear, scene switch/sync, object create/update, video create/dispose, React commits, history commits, saves and decode/network requests. Record on baseline and changed build; strip or guard instrumentation for production.
- Fixtures: landscape/portrait signage, 50 objects, 200 mixed objects, alternating native/painted layers, several videos, Arabic menu with QR/variables, locked Template, multi-scene composition; include slow loading and offline behavior.
- Acceptance per isolated two-second drag after initial load and pending saves settle: 0 canvas creations, 0 scene reloads, 0 media creations, 0 new network saves during pointer movement, 1 final model transaction/history entry. Reorder/property edits keep unaffected media identities. Measure frame-time percentiles on a named browser/device at DPR 1/2; target a 16.7 ms frame budget on the agreed reference machine, not an unqualified universal 60fps promise.
- Tests: repeated mount/unmount/scene switches and media replacement have bounded resource counts; pixel/corner comparisons; save/reload and concurrent-save integration; tenant isolation, source Template policy, clone/customize/save-as-asset, dynamic variables, old JSON and Player fixtures.
- Compatibility/release: keep old fixtures in CI; ship milestones behind a Designer2-specific rollout flag if needed. Do not expose schema-v2 writing until all readers/migrations support it. Record baseline/result metrics and unresolved limitations before declaring commercial quality.

## Execution order and review gates

1. M1 regression fixtures and persistent sync; carry policy constraints without adding more mutation entry points.
2. M2 insertion and M3 geometry fixtures/conversion; no global legacy normalization.
3. M4 complete policy-aware layers/selection; M5 comprehensive live properties.
4. M6 transactional history/save/recovery; M7 interaction and preview polish.
5. M8 full browser/API/Player validation and release evidence. Tests accompany every earlier milestone; M8 is not the first testing phase.

No milestone is complete merely because its UI exists. Require its tests, compatibility checks and acceptance evidence. Geometry migration or a new dependency requires a concrete documented rationale, not an assumption from this plan.

## Validation recorded for this review

- Existing `FabricCanvasAdapter.test.ts`: four tests pass (layer order/hit targeting, Arabic inline save/cancel, video interleaving/cleanup, editing locks/removal).
- These tests use jsdom with a stubbed raster context; they are not proof of pixel fidelity, transform round-trip correctness, network behavior or production performance.
- The previous task also ran a temporary Chromium harness for inline editing and mixed-layer order; that is useful context, not a substitute for committed reproducible M3/M8 tests.
- No production implementation was changed during this review. No new dependency or schema migration was added. No authenticated end-to-end workflow, measured memory profile or 60fps benchmark is claimed.


## M1 implementation record — 2026-09-09

- Added ID-based scene reconciliation with in-place geometry, text/shape style, video settings,
  capability and z-order updates. Image/QR content or resolved resource changes replace only
  affected objects; full clear is reserved for scene/document switches.
- Async preparation uses generation checks and abortable image loading. Stale/failed prepared
  objects are disposed, and late results cannot install into a different or disposed canvas.
- Active-scene selectors exclude unrelated document metadata from synchronization. Unchanged
  asset resolutions do not recreate media; unchanged video nodes retain playback position.
- Zoom uses one adapter path for the top bar and wheel. Manual zoom survives commits and
  container resize; explicit fit restores resize-to-fit behavior. ResizeObserver mounts once.
- Repeated live width/height edits use logical dimensions relative to existing object scale.
  Redundant guideline state updates are skipped. Scene animation activation waits for a current
  successful synchronization, including when an initial load is superseded.
- Regression coverage: adapter identity, geometry/style/reorder, native media identity/time,
  selective resource refresh, stale scene loads, disposal/abort, repeated live resize, fit/manual
  zoom; viewport metadata/selection/transform boundaries, scene identity and Strict Mode cleanup.
- Validation: focused dashboard tests, TypeScript and targeted ESLint; local Chromium harness
  passed mixed-layer rendering, inline Arabic save/cancel, zoom, persistent object identity and
  repeated live resizing. No new dependencies or schema changes. No authenticated full-app
  frame-time/network benchmark is claimed; M8 retains that release gate.
- Remaining work: M2 direct media insertion is next. M3 coordinate/Player parity and text reflow,
  M4 full multi-selection/policy enforcement, M5 remaining property-specific updates and M6 save
  races are unchanged in scope. The baseline audit above intentionally describes pre-M1 code;
  this implementation record and ADR amendment supersede its reconstruction findings.


## M2 implementation record — 2026-09-09

- Image and Video open a focused native modal with Upload and Choose from Assets. Selecting
  media inserts one complete element in one history transaction. Opening/cancelling the modal
  does not create an empty model object. Removed the obsolete disabled Uploads sidebar entry.
- Reused the tenant Asset list/get/upload APIs and shared AssetSelect, with no new storage or
  dependency. Upload/get accept optional cancellation signals without changing existing callers.
  Ready results prime the viewport's Asset cache before insertion.
- Processing waits are bounded to two minutes; metadata probes to 15 seconds. Failure/timeout
  remains in the dialog with a translated explanation. Closing, unmounting or switching scenes
  aborts pending work; late responses cannot insert into another scene. Accepted uploads remain
  ordinary library assets even if insertion is later cancelled.
- Video dimensions prefer metadata from the normalized transcode. Image metadata in the current
  worker describes the original encoded file, so browser natural dimensions are measured with
  the same anonymous-CORS mode as Fabric to respect displayed/EXIF orientation. Missing video
  dimensions use a temporary metadata-only video probe. Probe sources/listeners are released.
- New media keeps its source aspect ratio, never upscales small media, and uses at most 80% of
  the visible canvas intersection. Placement accounts for zoom/pan; a completely offscreen
  canvas falls back to the scene center. Geometry persists only assetId, never an ephemeral URL.
- Image Group and video Rect proxies have zero phantom stroke, so selection dimensions match
  their content box. Existing serialized positions/frame/crop fields are preserved; old
  asset-less frames still load and can be repaired through the existing Properties picker.
  Replacement behavior is unchanged. Rotation/Player geometry migration remains M3.
- Added English/Arabic media-flow labels and RTL dialog direction. Native modal focus containment,
  Escape/cancel and keyboard event isolation keep editor shortcuts out of the insertion flow.
- Validation: geometry/preparation/polling/cancellation/error/timeout/orientation tests; full shell
  tests for no placeholder, one-step undo, late-upload cancellation on close/scene switch, portrait
  video upload and Arabic UI; adapter tests for exact media bounds and viewport intersection.
  Chromium verified landscape/portrait image edge pixels and video DOM/control dimensions.
  No authenticated live upload or processing throughput benchmark is claimed.
- Next: M3 transform and rendering contract, using compatibility fixtures before changing
  rotation origins, scale normalization or saved geometry semantics.


## M3 implementation record (partial) — 2026-09-09

Scope of this slice: the x/y-rotation coordinate boundary only (the audit's Q5/root-cause finding
above). The remaining M3 tasks below are unstarted.

- Root cause confirmed by direct inspection: `FabricObjectFactory` set Fabric `left/top` directly
  from `element.x/y` under `originX/originY: 'left'/'top'`, and `FabricEventBridge`'s
  `object:modified` handler read `obj.left/top` straight back into `element.x/y` — both paths
  carried a comment asserting no conversion was needed. That's only true at rotation 0. Fabric's
  interactive rotation keeps the object's *center* fixed while adjusting `left/top`, so at any
  other angle `obj.left/top` (the rotated position of the local origin corner) is a different point
  than the Player's unrotated content-box top-left (`apps/player/.../DesignRenderer.tsx`: place at
  x/y unrotated, `transform: rotate()` around the box's own center). Every crossing of this
  boundary was silently wrong for rotated elements: creation, geometry sync/patch, live property
  updates (X/Y/W/H/rotation fields), extraction on `object:modified`, and animation enter/exit
  rest positions.
- Added `canvas/geometryContract.ts`: a pure `fabricPositionForElement(geometry, rotationDegrees)`
  (rotates the declared box's corner around its declared center using Fabric's own
  `util.rotateVector`/`degreesToRadians`, never the live object's rendered dimensions) plus
  `applyElementPosition`/`readElementGeometry` wrappers. Deliberately independent of a live
  object's actual size: a Fabric Textbox's real height comes from font metrics/wrapping and can
  differ from the stored element height, and an early version of this fix that used
  `setPositionByOrigin`/`getCenterPoint` (which read the *object's* size) mispositioned text and
  broke three existing tests before this was caught and fixed.
- Rewired every crossing to the shared helper: `FabricObjectFactory`'s post-build `obj.set` (create
  time), `FabricCanvasAdapter.syncScene`'s in-place patch branch (now repositions whenever any of
  x/y/width/height/rotation changes, not just x/y independently), `updateElement` (the live
  property-panel path — merges the patch onto the object's current geometry before repositioning,
  so e.g. a rotation-only edit keeps x/y fixed), `FabricEventBridge.bindModifiedEvents`
  (extraction), and `restingProps` (animation enter/exit rest state, which previously used
  `element.x/y` as a raw Fabric position and would misplace rotated elements during preview).
  `bindLiveTransformEvents`' drag-snapping (`object:moving`) still reads `obj.left/top` directly —
  left as is, matching the plan's own M7 scope ("Snapping ... uses unrotated bounds"); it's a
  translate-only gesture where that stays self-consistent, and rotation-aware snapping is separate,
  unstarted work.
- Also fixed, surfaced while writing corner-accuracy tests for the above: `createShapeObject` left
  `strokeWidth` unset for shapes with no configured stroke, so Fabric's own class default (1) was
  silently inflating `getScaledWidth/Height()` — and therefore selection bounds and this milestone's
  center math — by about a pixel even when no stroke was visible. Now defaults explicitly to 0. Image
  and video proxies already got the equivalent fix in M2.
- Tests: `geometryContract.test.ts` compares Fabric's placed corners against an independently
  written Player-style corner computation (own rotation math, no shared code with
  geometryContract.ts) at 0/30/90/180/270/-45°, round-trips apply→read at the same angles, and
  checks the Textbox-style live-dimension independence directly. `FabricCanvasAdapter.test.ts`
  adds an end-to-end pair through the real adapter: creation places a 30°-rotated shape at the
  declared box (center matches, raw Fabric left ≠ declared x), and a simulated rotate-and-release
  gesture (`object:modified`) extracts back to the original declared x/y. Full existing suite
  (50 tests) still passes; `tsc --noEmit` and `eslint` on the touched files are clean.
- Not done in this slice (remaining M3 scope, per the milestone's own task list): batching
  `ActiveSelection` member commits into one transaction; text corner-scale-vs-side-reflow font
  normalization; crop/fit/flip preservation through the same boundary; composing viewport and group
  matrices for the DOM text/video overlays at non-identity zoom/pan; a v1 editor/Player compatibility
  fixture library; DPR 1/2 and zoom/pan visual tests; and the explicit, undoable legacy-frame
  normalization for existing rotated v1 designs whose original intent under the old (wrong)
  contract is ambiguous — those designs are unaffected by this change (nothing here alters what's
  read from or written to already-saved JSON differently; the fix only changes how the *editor*
  positions Fabric objects for a given x/y/rotation, and only rotated elements were ever affected in
  the first place), but M3's own compatibility section still calls for that normalization pass
  before considering the milestone complete.
- No schema change, no new dependency, no production deploy in this slice.


## M3 implementation record, continued — 2026-09-09

Second slice, same day, picking up the remaining M3 task list the first record left open.

- **Multi-select (`ActiveSelection`) commits were completely dropped before this slice** —
  discovered while implementing the plan's own "batch ActiveSelection members into one
  transaction" task, not a pre-existing known bug in the audit's write-up. `bindModifiedEvents`
  checked `obj.elementId`, which an `ActiveSelection` (a synthetic multi-select container, not a
  design element) never has, so the whole handler silently no-opped: dragging, resizing or
  rotating two or more selected elements together moved them on screen but never wrote anything to
  the store. The *next* unrelated edit that triggered a scene resync would then snap them back to
  their pre-drag position, since reconciliation trusts the store as authoritative.
- Added a second callback, `onElementsModified` (`CanvasAdapterCallbacks`), alongside the existing
  single-element `onElementModified`. `bindModifiedEvents` now detects an `ActiveSelection` target,
  reads every member's geometry, and reports them together in one call; `CanvasViewport` wraps that
  in the same `commit()` used everywhere else, so a multi-select gesture is one undo step, matching
  every other mutation path.
- Getting each member's geometry right took real empirical work, not assumption: a grouped
  member's own `left`/`top`/`angle` are *local to the selection*, not canvas-absolute, while it's
  still grouped — confirmed by constructing a two-rectangle `ActiveSelection`, rotating it 90°, and
  comparing candidate extraction formulas against Fabric's own `getCoords()` corner output as
  ground truth. An initial attempt using `calcTransformMatrix()` decomposed via `qrDecompose` gave
  wrong answers for a rotated group (verified against hand-computed expected centers) and was
  discarded. **`readElementGeometry` (`geometryContract.ts`) now always extracts from
  `obj.getCoords()`** (bounding-box corners), independently verified correct for solo objects,
  rotated groups, and scaled+rotated groups — this is now the one implementation for both cases,
  replacing the `getCenterPoint()`-based version from the first M3 slice, which was only ever
  correct for a standalone object.
- **Text corner-resize now folds scale into `fontSize` instead of leaving it on the object.**
  Traced Fabric's actual default `Textbox` controls (`commonControls.mjs`) rather than assuming:
  corner handles (`tl/tr/bl/br`) always use `scalingEqually` (guaranteed uniform scaleX===scaleY),
  side handles (`ml/mr`) use `changeWidth` (resizes `width` directly, with reflow, never touches
  scale) — Fabric already does the right thing for side-resize with no changes needed here.
  `DesignElement` never persists `scaleX`/`scaleY`, so a corner-scaled Textbox's enlarged
  appearance previously survived only on the live Fabric object and silently reverted to its old
  font size on the next recreate (undo, reload, scene switch) — confirmed by direct inspection, not
  reproduced through the UI. `bindModifiedEvents` now folds `scaleX`/`scaleY` into `fontSize`/
  `width` and resets scale to 1 for a standalone text object before extracting geometry; empirically
  confirmed that reassigning `fontSize`/`width` via Fabric's own property setters triggers its
  normal reflow/height recompute, so this doesn't bypass Fabric's own text layout.
  **Deliberately not extended to a text element inside a multi-select**: confirmed empirically that
  Fabric does not push an `ActiveSelection`'s composed scale down into a member's own
  `scaleX`/`scaleY` until the selection is later dissolved, so at `object:modified` time a grouped
  Textbox's own scale still reads 1 — there's nothing to fold yet, and guessing an effective scale
  from the composed geometry and writing it now would double up once Fabric's own pushdown runs
  afterward. Left as an explicit, documented gap rather than a guessed fix.
- **Mirroring/skew**: `DesignElement` has no skew or flip fields for any type, so any skew a user
  could trigger via Fabric's default Alt-drag skew action would render correctly until the next
  recreate and then silently disappear. Set `lockSkewingX`/`lockSkewingY: true` on every created
  object (`FabricObjectFactory.ts`) instead of leaving that interaction available with no way to
  persist its result — an explicit "not supported yet" rather than a quiet, undocumented gap.
  Flip remains equally unsupported and equally unexposed in the UI; no control offers it, so no
  corresponding lock was needed.
- **Crop/fit preservation reviewed, not touched**: `positionImageInBox`/`buildImageClipPath`
  operate entirely in the image Group's own local coordinate space (crop pan/zoom offsets relative
  to the group's local center), independent of how the group's own overall x/y/rotation gets
  applied. Confirmed by reading the code that this slice's position-boundary changes cannot affect
  it; the existing crop/fit tests (from M2) still pass unchanged.
- **A second phantom-stroke bug, same class as M2's**: Fabric's `Textbox` also defaults
  `strokeWidth` to 1 when unset, inflating `getCoords()`-derived width by a phantom pixel — caught
  by the new text-normalization test expecting an exact width, not assumed. `FabricObjectFactory`
  now passes `strokeWidth: 0` for text, matching what M2 already did for image/video and this
  slice's earlier fix for shapes.
- Tests: two new adapter-integration tests (multi-select rotate → one batched call with correct
  per-member geometry, verified against independently-derived expected centers; text corner-scale →
  folded fontSize/width with scale reset to 1, verified against the live object's own post-commit
  state). Full suite: 52 passing (up from 50). `tsc --noEmit` and `eslint` on touched files clean.
- Not done (remaining M3 scope): image/video crop/fit/flip through a *rotated* box specifically
  (reviewed as unaffected, not stress-tested under rotation); composing viewport and group matrices
  for DOM overlays — already handled by the existing `calcTransformMatrix()`-based
  `applyOverlayGeometry`, confirmed by this slice's own empirical matrix-composition tests, so nothing
  further was needed there; a v1 editor/Player compatibility fixture library; DPR 1/2 and zoom/pan
  visual tests; and the explicit, undoable legacy-frame normalization for existing rotated v1
  designs called for in M3's compatibility section.
- No schema change, no new dependency, no production deploy in this slice.


## M3 closeout note — 2026-09-09

Queried production directly (read-only) rather than assuming: `DesignAsset` (8 rows, 22 elements
across all scenes) and `DesignTemplateVersion` (0 rows) both checked via
`jsonb_path_query(... '$.scenes[*].elements[*] ? (@.rotation != 0)')` — zero elements with
non-zero rotation exist anywhere in production. The "legacy-frame normalization for existing
rotated v1 designs" compatibility task in M3's own write-up is therefore not currently live risk:
there is nothing rotated to reinterpret. This doesn't retire the task permanently — it should be
re-checked if this finding is ever relied on again after further production usage — but it means
M3's coordinate-contract fix could ship without a migration step, which it already has (see the
deployment record). Added zoom-invariance regression tests (`it.each([0.25, 1, 2, 3])`) confirming
committed geometry is unaffected by the canvas's current zoom level, closing part of the
DPR/zoom-pan testing gap; true DPR/retina pixel-rendering tests still need a real browser.


## M4 implementation record (partial) — 2026-09-09

Two bugs from the M0 audit's finding #8 fixed, both with empirically-verified regression tests
(each confirmed to fail without its fix, not just pass with it):

- **Selection reporting used Fabric's raw event delta, not the full selection.**
  `bindSelectionEvents`' `selection:updated` handler read `e.selected` directly — confirmed
  empirically (installed Fabric 7.4.0) that this event's `e.selected` contains only the
  newly-added object when a user shift-clicks to extend an existing multi-select, not the full
  current selection. The store would have received just the one newly-clicked id, silently
  dropping every previously-selected element from `selectedElementIds`. Fixed by reading
  `canvas.getActiveObjects()` (the authoritative full selection) in both `selection:created` and
  `selection:updated` handlers instead of trusting either event's own payload.
- **`selectElements` could make a hidden or locked element the canvas's active object.** The
  Layers panel can select a hidden/non-selectable row for management purposes (rename, toggle
  visibility back on, etc.) without that translating into an on-canvas interactive selection box
  around content that isn't actually visible or draggable. `selectElements` now filters
  `visible !== false && selectable !== false` before building the Fabric active
  object/`ActiveSelection`, while leaving the store's own `selectedElementIds` (and therefore the
  Properties panel) untouched — layer management keeps working for hidden/locked rows, only the
  canvas-level selection visualization is suppressed.
- Tests: `Designer2 selection reporting (M4)` — full-selection-after-shift-click-add, and
  hidden/locked-then-mixed-selection resolving to only the valid member. Both temporarily reverted
  and re-verified to fail without their respective fix. Full suite: 59 passing (up from 56).
  `tsc --noEmit` and `eslint` clean.
- Not done at the time of the record above: row rename/duplicate/delete/reorder discoverability
  directly in the Layers panel (currently scattered across properties/context menu per the M0
  audit — a UX consolidation, not a correctness bug), and keyboard-accessible DnD/context menu.


## M4 implementation record, continued — server-side Template policy enforcement — 2026-09-10

The largest remaining M4 item from the record above: source Template content/style/geometry
restrictions were enforced only via disabled UI controls — nothing stopped a forged
`PATCH /designs/:id` request (or a client bug) from changing a Template-locked layer anyway.

- Added `DesignsService.assertTemplatePolicyRespected` (`apps/api/src/modules/designs/
  designs.service.ts`), called from `update()` (the manual-save path) whenever the design being
  saved has a `sourceTemplateId`/`sourceTemplateVersion`. Fetches the *immutable*
  `DesignTemplateVersion` row (never the live, still-editable `DesignTemplate`) as the
  authoritative ground truth, so a later admin edit to the template can't retroactively tighten or
  loosen a design a tenant already cloned.
- Partitioned each element type's own fields (read directly from
  `packages/design-schema/src/element.schema.ts`, not guessed) into content (`text`, `assetId`,
  `shape`, `value`, `posterAssetId`) vs style (fonts/fill/crop/adjustments/playback settings/QR
  colors/opacity/animation) — matching `TemplateLayerPolicy`'s own two axes. Geometry
  (x/y/width/height/rotation) is separately gated by the existing `movable`/`resizable` flags
  every element already carries.
- For each element that exists in both the source template and the incoming document and was
  governed in the source (a `templatePolicy`, or `movable`/`resizable`/`deletable` off): rejects
  (`ForbiddenException`) an attempt to move/resize/delete it, change its `type`, change any
  content/style field a `false` policy locks, or loosen any governance flag itself (a customer can
  always self-restrict further, never relax what the template granted). A customer's own,
  never-template-managed elements are completely untouched by this.
- Numeric comparisons use a sub-pixel epsilon (not exact equality) to tolerate legitimate
  editor round-trip float noise without false-positive rejections; object fields (`adjustments`,
  `animation`) compare via canonical key-sorted JSON so key-order alone isn't treated as a change.
- Tests (`designs.service.spec.ts`, Jest): 8 new cases — move/content/style/unlock-attempt/
  delete/type-swap all rejected; an unchanged locked element and a customer's own free edits
  alongside an untouched locked one both still succeed (no false positives). All 8 confirmed to
  actually depend on the fix (temporarily disabled it, watched 6 of 8 fail as expected, restored
  it). Full API suite: 284 passing (26 suites, up from 276/25). `tsc --noEmit`, `eslint`, and
  `nest build` all clean.
- Not done: the same enforcement on the autosave draft path (`putDraft`) — drafts never become
  canonical without a real `update()` call, which is now protected, so this is lower-priority
  defense-in-depth rather than a live gap.
- Deployed 2026-09-10 (`lumina-api:m4policy-20260910`) — see designer2-m3-deployment.md's third
  deployment section.


## M4 implementation record, continued — Layers panel action discoverability — 2026-09-10

The last open M4 item: rename/visibility/lock/duplicate/delete/four-reorder actions all already
worked (via the Properties panel's inline expansion or the canvas right-click menu), but none of
them were reachable directly from a Layers-panel row — exactly the audit's complaint.

- `components/LayersPanel.tsx` (shared by designer2's ObjectsPanel and the legacy Themes/Layouts
  editors) gained, all as independently optional props so the legacy usages are unaffected:
  double-click-to-rename on the row label (inline `<input>`, Enter commits/Escape cancels),
  visibility and lock toggle icons, and a "more actions" button whose anchor position the caller
  controls (so it can reuse whatever popup it already has). Added `KeyboardSensor` (dnd-kit's own
  `sortableKeyboardCoordinates`) alongside the existing `PointerSensor` — Space-to-pick-up,
  arrow-keys-to-move on a focused row's drag handle — closing the "keyboard-accessible DnD" task.
- `ObjectsPanel.tsx` wires these to the same store methods (`updateElement`, `duplicateElements`,
  `removeElements`, `reorderElement`) and the same `useConfirmBeforeDelete` confirmation the
  canvas right-click menu already uses, and reuses the existing shared `ContextMenu` component
  (not a new popup implementation) for the "more actions" list — front/forward/backward/back,
  duplicate, show/hide, lock/unlock, delete — matching `CanvasViewport`'s `buildContextMenuActions`
  action set exactly, so the two surfaces (right-click a canvas element vs. the panel row for the
  same element) offer the identical set with identical semantics.
- Two real bugs caught by writing tests, not by reading the code — both were "looks correct on
  inspection" cases:
  - A test-setup bug: two shape elements built independently both got `zIndex: 0` because each
    call passed an empty `elements` array to `createShapeElement` instead of threading the
    growing list through, so a "Send Backward" reorder test showed no observable change. Fixed
    in the test, not the product.
  - A real product bug this session's own code introduced while fixing it: the rename input's
    "select all text so typing overwrites the placeholder" behavior was implemented as a
    `useEffect` keyed on the input's own controlled value — which changes on every keystroke — so
    it re-selected the entire current value after each character, meaning every new keystroke
    replaced the whole string instead of extending it. Typing "Renamed" would have persisted just
    "d". Switching to a `useCallback`-stabilized ref callback (invoked once, on mount, rather than
    on every value change) fixed it. Caught only because the test typed a full word and asserted
    the final value, not because the bug was visible in a code read.
- Tests: 8 new (`ObjectsPanel.test.tsx`) covering rename commit/cancel, visibility toggle, lock
  toggle (both flags), duplicate via the actions menu, delete via the actions menu, reorder via
  the actions menu, and that every row action is wrapped in `commit()` (one undo step, matching
  every other mutation path in this feature). Full suite: 110 passing (up from 102).
  `tsc --noEmit`, `eslint` (0 errors), and `next build` all clean.
- This closes out M4's stated task list in full. Not deployed yet.
