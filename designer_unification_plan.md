# Lumina Designer Unification Plan

## 1. Objective

Lumina currently contains three designer implementations. The long-term goal is to keep **one production designer only**.

The target is **not** to merge the old Theme Designer and Designer2 blindly, and it is **not** to replace Designer2's architecture with the Theme persistence model.

The target is:

> **Use the proven, working editing tools and workflow from Theme Designer inside Designer2, while preserving Designer2 as the canonical document, persistence, asset, scene, template, versioning, and player architecture.**

In short:

- **Theme Designer contributes the mature editor UI and working tools.**
- **Designer2 contributes the long-term architecture and persistence model.**
- **Layout Designer contributes only capabilities that are still required, such as playlist regions, widget regions, and audio behavior.**
- The final product must be a single editor: **Lumina Designer**, backed by `DesignDocument`.

---

## 2. Current Situation

### 2.1 Designer2 UI and tooling problems

Designer2 currently uses a split editor UI:

- A vertical tools toolbar on the **left side** of the screen.
- A separate properties/inspector panel on the **right side**.
- Selecting a tool or object requires moving between the left toolbar and right properties panel.

More importantly, several Designer2 tools are currently incomplete or unreliable. Basic operations such as image upload and video upload are not functioning correctly, and multiple editor tools are not production-ready.

Designer2 must therefore **not be treated as the source of truth for editor-tool implementation simply because it is the newer editor**.

### 2.2 Theme Designer UI and tooling strengths

Theme Designer currently has a much more mature and proven editor experience:

- The tool controls and their properties are organized together in a **single right-side column/panel**.
- Tools and their related settings are presented in one coherent workflow.
- The existing tools are already functional and tested in real use.
- Image/media interaction and other editing operations are more reliable than their Designer2 equivalents.

This UI/UX and the working tool implementations should be reused rather than rewritten unnecessarily.

### 2.3 What Theme Designer must NOT contribute

Theme Designer must **not** become the final persistence architecture.

Do not preserve or reintroduce legacy persistence patterns merely because the Theme tool implementation uses them today.

In particular:

- Do not make Theme JSON the canonical design format.
- Do not store uploaded media as inline base64 payloads in the final `DesignDocument`.
- Do not create a second persistence path for ported Theme tools.
- Do not keep Theme-specific save logic after a tool has been integrated into Designer2.

Theme is a **source of working editor behavior and UI**, not the target storage architecture.

---

## 3. Architectural Rule

The final architecture must follow this rule:

```text
Theme working UI/tools
        |
        v
Designer2 editor integration/adapters
        |
        v
DesignDocument (@lumina/design-schema)
        |
        +--> Asset references by assetId
        +--> Scenes / timeline
        +--> Variables / dynamic bindings
        +--> Templates
        +--> Revision / concurrency
        +--> Version history
        +--> Draft autosave
        |
        v
Unified Player hydration/rendering
```

The visual editor may reuse Theme code, but **every edit must ultimately mutate Designer2 state and produce a valid `DesignDocument`.**

---

## 4. UI Decision

### Remove the current Designer2 split toolbar layout

The current Designer2 layout of:

```text
LEFT: tools toolbar
CENTER: canvas
RIGHT: properties inspector
```

should be retired.

### Adopt the Theme editor's right-side tool workflow

The target layout should be closer to:

```text
CENTER / MAIN AREA
- Canvas / artboard
- Scene editing area

RIGHT SIDEBAR
- Templates
- Text
- Image
- Video
- Shape
- Playlist
- Document
- Widgets
- QR
- Icons
- Brush / drawing (if retained)
- Other supported tools

Each tool opens or contains its own related controls/properties in the same right-side workflow.
```

The intent is to reuse the Theme Designer's working tool organization and interaction model rather than rebuilding the same functionality in Designer2's existing left/right split UI.

### Required new item: Templates

Theme's tools sidebar is missing one major item required by the new architecture:

> **Templates**

Add a `Templates` button/section to the unified right sidebar.

Templates must use Designer2's template/document architecture, not introduce a legacy Theme template format.

---

## 5. Critical Separation of Responsibilities

The implementation must clearly separate four layers.

### Layer A — Editor UI

Reuse as much as practical from Theme:

- Toolbar/sidebar components
- Tool panels
- Property controls
- Media selectors
- Text controls
- Shape controls
- Animation controls
- Gradient/color controls
- Widget configuration UI
- Playlist selection UI
- Document controls
- Any other stable editing UI

### Layer B — Editor behavior

Reuse proven Theme logic where it is independent enough to reuse safely:

- File selection
- Upload initiation
- Drag/drop behavior
- Element creation workflow
- Selection behavior
- Property manipulation
- Crop/edit interactions
- Media preview
- Widget configuration workflow
- Animation selection

Where Theme behavior writes directly into `Theme.elements`, replace only the state adapter/write layer.

### Layer C — Canonical document state

All final editor state must be represented as Designer2 `DesignDocument` data.

Do not maintain a hidden Theme document beside the DesignDocument.

Do not synchronize two permanent documents.

There must be **one canonical editing state**.

### Layer D — Persistence and media

Keep Designer2's architecture:

- `DesignDocument`
- `schemaVersion`
- Design assets
- `assetId` references
- server-side media resolution
- revision/concurrency protection
- version history
- autosave/drafts
- scenes and scene durations
- variables/dynamic bindings

---

## 6. Image and video Upload Integration

Image upload is currently broken or unreliable in Designer2. Do not spend time rebuilding it from zero if Theme already has a reliable upload flow.

Reuse the proven Theme upload interaction, but change the destination and resulting state.

### Required target flow

```text
User clicks Image
    -> Theme-derived image UI opens
    -> User selects/uploads image
    -> Existing/proven media upload API is used
    -> Server creates/stores Asset
    -> API returns assetId + metadata
    -> Designer2 creates an ImageElement
    -> ImageElement stores assetId
    -> DesignDocument is updated
    -> Draft autosave/versioning continues normally
```

Example target state:

```json
{
  "id": "element_x",
  "type": "image",
  "assetId": "asset_x",
  "x": 120,
  "y": 80,
  "width": 640,
  "height": 360,
  "fit": "cover"
}
```

The uploaded binary must **not** be embedded in the design JSON.

If Theme currently returns a data URL/base64 value at any stage, that value may be used temporarily for local preview if necessary, but the saved design must reference the stored Asset by `assetId`.

---

## 7. Video Upload Integration

Apply the same strategy to video.

### Required target flow

```text
User clicks Video
    -> Theme-derived video/media UI opens
    -> User selects/uploads video
    -> Existing/proven upload service stores the media
    -> Asset record is created
    -> assetId + metadata are returned
    -> Designer2 creates VideoElement(assetId)
    -> Canvas/player preview resolves the media through the existing asset pipeline
    -> DesignDocument stores only the reference and element properties
```

Preserve relevant metadata and capabilities where available:

- MIME type
- width/height
- duration
- poster/thumbnail
- crop
- fit
- autoplay/playback behavior required by signage
- mute/volume where supported

Do not introduce a separate Theme video-storage system.

---

## 8. Tool Migration Strategy

Do **not** perform a big-bang copy of the Theme editor.

Migrate tools one by one through a controlled adapter strategy.

For each tool, document:

1. Existing Theme UI component(s)
2. Existing Theme behavior/service dependencies
3. Theme schema fields currently read/written
4. Matching Designer2 element/schema fields
5. Missing Designer2 fields that must be added
6. Asset/upload dependencies
7. Player renderer support
8. Migration compatibility requirements

Then classify the tool as one of:

- **Reuse directly** — UI/logic can work against Designer2 with small changes.
- **Reuse with adapter** — keep UI/behavior but map reads/writes to Designer2 schema.
- **Extract shared component/service** — useful code should be moved to a shared package instead of duplicated.
- **Reimplement only when necessary** — use only where the Theme implementation is tightly coupled to legacy state or contains an architectural problem.
- **Discard** — feature is obsolete or not worth carrying forward.

---

## 9. Recommended Migration Order

### Phase 1 — Architecture protection

Before moving UI components:

- Confirm `DesignDocument` remains the only target state.
- Add tests that reject accidental Theme-document persistence from Designer2.
- Identify all Designer2 save/autosave/version-history entry points.
- Identify media upload and Asset APIs.
- Identify Theme upload services/components that already work.
- Create a clear editor adapter/service boundary.

No legacy editor should be deleted yet.

### Phase 2 — Replace Designer2 shell/sidebar

- Remove/disable the current Designer2 left tools toolbar.
- Remove the existing dependency on a permanently separate right properties inspector where the new Theme-style tool panel replaces it.
- Port/adapt Theme's unified right-side tools panel into Designer2.
- Preserve Designer2 canvas, selection model, scene system, document state, autosave, and persistence.
- Add `Templates` to the new sidebar.

Do not connect every tool immediately. First establish the final shell safely.

### Phase 3 — Image tool proof of architecture

Integrate Image first because it tests the most important boundaries:

- Theme-derived UI
- file selection
- upload service
- Asset creation
- assetId
- Designer2 element creation
- canvas rendering
- save
- autosave
- reload
- player rendering

Acceptance test:

> Upload an image in the new unified Designer, save the design, reload the editor, and play it in Player. The stored DesignDocument must contain an `assetId`, not embedded image data.

### Phase 4 — Video tool

Repeat the same end-to-end integration for video.

Acceptance test:

> Upload a video, place/resize it, save, reload, and play it successfully while keeping DesignDocument storage reference-based.

### Phase 5 — Core editing tools

Port/adapt the stable Theme tools:

- Text
- Shape
- QR
- Image properties
- Video properties
- colors
- gradients
- typography
- opacity
- alignment
- rotation
- layer/z-index controls
- crop/fit controls
- animation controls

Prefer Theme UX where it is already superior and working.

### Phase 6 — Signage-specific tools

Add/port the capabilities Designer2 currently lacks but Lumina requires:

- Widget element
- Playlist element
- Document element
- audio priority / per-element audio volume if required
- ticker/live-data behavior
- prayer/weather/time/date/currency widgets

These should be represented as new Designer2 element types or clean extensions of the DesignDocument schema.

### Phase 7 — Theme advanced capabilities

Evaluate and port only the valuable capabilities:

- Text translations/localization
- RTL behavior
- emphasis/exit/text-reveal animation parity
- reusable palette/theme tokens
- typography tokens
- per-element clipping/masks
- icons
- brush/drawing

Do not copy embedded SVG/base64 persistence merely for compatibility.

### Phase 8 — Templates

Implement Templates as a first-class Designer2 workflow.

Required behavior:

- Templates are based on valid `DesignDocument` data.
- Loading a template creates/initializes a design using the existing Designer2 template workflow.
- Editing a design created from a template does not accidentally mutate the original template.
- Preserve variables/dynamic bindings.
- Template previews use the same renderer as normal designs as much as possible.

### Phase 9 — Legacy migration

Implement explicit converters:

- `Theme -> DesignDocument`
- `Layout -> DesignDocument`

Do not rely on manually recreating legacy customer designs.

Migration must preserve supported behavior wherever a Designer2 equivalent exists.

Unsupported legacy behavior must be reported/logged explicitly rather than silently dropped.

### Phase 10 — Player unification

Once DesignDocument supports the required legacy features:

- migrate existing content
- reduce separate Theme/Layout/Design hydration logic
- move toward a single DesignDocument player contract
- verify web Player behavior
- verify Flutter/WebView shell behavior

### Phase 11 — Legacy removal

Only after migration and verification:

- remove Theme Designer routes/pages
- remove Layout Designer routes/pages
- remove unused legacy editor components
- remove obsolete hydration paths
- remove obsolete API endpoints only when no live content depends on them
- remove obsolete database structures only after data migration and rollback safety are complete

---

## 10. Adapter Pattern

Avoid changing working Theme UI components more than necessary.

Use a Designer2 adapter/controller layer.

Conceptually:

```ts
interface DesignerEditorAdapter {
  addText(input: TextToolInput): void
  addImage(assetId: string, input?: ImageToolInput): void
  addVideo(assetId: string, input?: VideoToolInput): void
  addShape(input: ShapeToolInput): void
  updateElement(elementId: string, patch: unknown): void
  removeElement(elementId: string): void
  selectElement(elementId: string): void
}
```

Theme-derived UI should call editor commands such as these instead of writing Theme schema objects directly.

The implementation of these commands writes into the current Designer2 scene and validates against `@lumina/design-schema`.

This prevents the Theme UI from contaminating the final persistence architecture.

---

## 11. Schema Extension Rules

When a Theme capability has no Designer2 equivalent, do not fake it through arbitrary JSON fields without validation.

Instead:

1. Determine whether the feature belongs in the unified product.
2. Define/extend the appropriate Zod schema in `@lumina/design-schema`.
3. Add the element/property to the canonical TypeScript types.
4. Add editor support.
5. Add player/rendering support.
6. Add migration mapping from Theme/Layout if applicable.
7. Add tests.

The schema remains the source of truth.

---

## 12. Media Persistence Rules

These rules are non-negotiable for the unified editor:

- Uploaded images/videos/documents must be Assets.
- Persist `assetId`, not binary content.
- Do not introduce base64 media into `DesignDocument`.
- Do not save browser object URLs.
- Do not save temporary upload URLs as permanent references.
- Player hydration should resolve asset references to the appropriate usable URL.
- Keep media metadata in the Asset system or explicitly modeled fields, not duplicated inconsistently across editor implementations.

For Brush/drawing:

- If a raster result must be persisted, upload it as an Asset and reference the resulting `assetId`.

For icons:

- Prefer a controlled icon ID/library or sanitized asset pipeline over arbitrary inline SVG persistence.

---

## 13. Features That Must Be Preserved From Designer2

Porting Theme UI must never regress these Designer2 capabilities:

- `DesignDocument` canonical format
- `schemaVersion`
- multi-scene support
- scene duration/timeline behavior
- variables
- dynamic bindings
- template support
- asset references
- revision / optimistic concurrency
- version history
- draft/autosave recovery
- Designer2 save/restore lifecycle
- player contract/hydration direction
- future schema migrations

Any implementation that makes a Theme tool work by bypassing these mechanisms is considered incorrect.

---

## 14. Features That Must Be Preserved From Theme

Where currently working and relevant, preserve the behavior and usability of:

- unified right-side tools/properties workflow
- reliable image selection/upload interaction
- reliable video/media workflow
- text editing controls
- image controls
- video controls
- shapes
- gradients
- animation configuration
- widget controls
- playlist controls
- document controls
- icons if retained
- brush/drawing if retained
- localization/RTL where supported
- any mature property editor that is better than the current Designer2 equivalent

Do not downgrade a mature Theme tool merely to match an incomplete Designer2 implementation.

---

## 15. Layout Designer Capabilities to Salvage

Layout Designer does not need to survive as an independent editor, but its useful signage concepts must be preserved where required:

- region/element bound to Playlist
- region/element bound to Widget
- per-region audio priority
- per-region audio volume
- crop/offset behavior

These should become capabilities of Designer2 elements rather than a separate Layout document type.

---

## 16. Do Not Do These Things

### Do not perform a visual copy only

Moving the Theme sidebar JSX into Designer2 while leaving tools wired to Theme state is not migration.

### Do not maintain two state trees

Do not keep both:

```text
Theme state
+ Designer2 DesignDocument state
```

as permanent synchronized editor models.

There must be one canonical document state.

### Do not convert the DesignDocument into Theme format on save

The target persistence format is DesignDocument.

### Do not downgrade Designer2 architecture to make porting easier

Do not remove scenes, revisions, autosave, versioning, variables, bindings, or asset references.

### Do not rewrite working tools without evidence that reuse is impractical

Prefer reuse/extraction/adaptation over unnecessary rewrites.

### Do not delete legacy editors before migration is proven

Keep them available for compatibility/verification until converted content is validated.

### Do not silently lose Theme/Layout features

If a feature cannot yet be represented in DesignDocument, explicitly mark it as unsupported and keep the legacy path until the gap is closed.

---

## 17. Testing Requirements

Every migrated tool must have end-to-end tests covering:

1. Create element
2. Edit properties
3. Save
4. Reload editor
5. Verify persisted DesignDocument
6. Verify no Theme-only state is required
7. Verify asset references
8. Verify autosave/draft behavior
9. Verify version creation where applicable
10. Render in Player

Media tools must additionally test:

- upload success
- upload failure
- unsupported file type
- large file behavior
- canceled upload
- asset deletion/missing asset handling
- thumbnail/preview
- reload after save

Scene-sensitive tools must be tested across multiple scenes to ensure Theme-derived code does not accidentally behave as a single-frame editor.

---

## 18. Recommended First Implementation Milestone

Do not attempt the full migration first.

Build one vertical slice:

### Milestone: Unified sidebar + Image

1. Integrate the Theme-style right sidebar into Designer2.
2. Remove the Designer2 left toolbar for the migrated Image path.
3. Add `Templates` placeholder/button to the sidebar.
4. Reuse/adapt Theme's Image tool and upload interaction.
5. Upload through the existing Asset pipeline.
6. Create/update Designer2 `image` elements using `assetId`.
7. Save using the existing Designer2 persistence lifecycle.
8. Reload successfully.
9. Render successfully in Player.
10. Confirm version history/autosave remain operational.

Only after this vertical slice is correct should the same pattern be repeated for Video and the remaining tools.

This milestone is the architectural proof that:

> **Theme UX can operate on Designer2 persistence without importing Theme persistence.**

---

## 19. Definition of Done

The unification project is complete when:

- Users see only one Lumina Designer.
- The editor uses the mature Theme-style right-side tool workflow.
- Templates are available in the same tool area.
- All required tools function correctly.
- Image/video/document uploads use the Asset pipeline.
- Designs persist only as `DesignDocument`.
- Multi-scene/timeline remains fully functional.
- Variables/dynamic bindings remain functional.
- Autosave, revisions, and version history remain functional.
- Theme and Layout content can be migrated to DesignDocument.
- Player can render migrated content without requiring separate legacy document types.
- Legacy designers can be removed without customer-content loss.

---

## 20. Final Instruction to the Implementing Agent

Treat this as a **controlled editor unification**, not a cosmetic merge and not a rewrite.

Before modifying a working Theme tool, trace its UI component, state dependencies, upload/service calls, persistence assumptions, and Player requirements.

Before replacing any Designer2 subsystem, determine whether it belongs to the editor UI or to the long-term architecture.

The governing principle is:

> **Take from each implementation what is already proven to work, but keep Designer2 / DesignDocument as the architectural center of gravity.**

When there is a conflict between:

- Theme editor UX/tool maturity, and
- Designer2 persistence/document architecture,

keep **Theme's proven UX/tool behavior** and adapt it to **Designer2's architecture**.

Do not sacrifice either side unnecessarily.
