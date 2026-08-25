# Spark Screens Designer — V1 Implementation Plan

> **Document:** `designer.md`  
> **Product:** Lumina / Spark Screens Signage SaaS  
> **Status:** Implementation Plan  
> **Primary Canvas Engine:** Fabric.js  
> **Reference Project:** `onerkiz/fabric-canvas-editor` and selected Fabric.js editor implementations as UX/engineering references only  
> **Core Principle:** Build a native Spark Screens Designer integrated into the existing Lumina architecture. Do not fork or depend on a third-party editor application as the product foundation.

---

## Executive Decision

Spark Screens Designer will be implemented as a first-class module inside the existing Lumina dashboard.

The editor will use **Fabric.js as the canvas engine** and React/Next.js for the surrounding application UI. Existing open-source Fabric.js editors may be studied for proven implementation patterns such as object selection, snapping, image filters, history, keyboard shortcuts, layer management, and export behavior. Their application architecture must not become the permanent architecture of Spark Screens Designer.

The canonical result of the designer is **structured, versioned Design JSON plus external asset references**. Images, videos, audio files, fonts, thumbnails, and rendered previews must not be embedded as Base64 payloads inside the Design JSON.

The Designer and Player must share a stable design contract, but the Player must not depend directly on Fabric.js serialization internals. A Lumina-owned Design JSON schema is the compatibility boundary.

Templates and customer-created designs are separate domain objects:

- **Template:** curated reusable design managed by Super Admin.
- **Customer Asset Design:** a customer-owned editable design created from scratch or cloned from a Template.
- Customers never modify the original Template.
- Opening a Template creates an editable working copy.
- Saving that working copy creates a new customer Asset Design.
- A Template may be global, assigned to selected customers, selected tenant groups, or hidden.
- Super Admin may define which layers and dynamic fields are editable when a customer customizes a Template.

V1 supports:

- Single Scene and Multi Scene designs.
- Photoshop-style Layers.
- Images, Text, Shapes, QR, and Video layers.
- Backgrounds.
- Timeline and per-scene duration.
- Basic enter/exit/emphasis animations.
- Dynamic variables.
- Arabic, Hebrew, English, RTL and LTR.
- Autosave.
- Undo/Redo.
- Preview.
- Player playback.
- Tenant isolation.
- Super Admin template management.

---

# 1. Objectives & Scope

## 1.1 Product Objective

Build a visual signage design environment that allows a non-technical customer to create screen content quickly while allowing the Super Admin to maintain centrally managed reusable Templates.

The editor must feel closer to a simplified Canva/Photoshop-style interface than to a generic form builder.

## 1.2 V1 Business Objectives

V1 must allow:

1. Super Admin to create reusable Templates.
2. Super Admin to decide which customers can see each Template.
3. Customers to browse authorized Templates.
4. Customers to open a Template without modifying its original source.
5. Customers to customize permitted content.
6. Customers to save the result into their own Asset library.
7. Customers to create a design from scratch.
8. Customers to use their saved design in playlists and schedules.
9. The Player to render the saved design consistently.
10. Designs to continue playing after temporary loss of internet when assets are already cached by the Player.

## 1.3 V1 Design Capabilities

The Designer will support:

- Canvas sizes and orientation.
- Background color/image/video.
- Text.
- Images.
- Basic geometric shapes.
- QR codes.
- Videos.
- Layer ordering.
- Layer visibility.
- Layer locking.
- Layer naming.
- Positioning and sizing.
- Rotation.
- Opacity.
- Alignment.
- Duplicate.
- Delete.
- Copy/paste.
- Undo/redo.
- Zoom and pan.
- Guidelines/snapping.
- Scenes.
- Timeline.
- Basic animations.
- Dynamic variables.
- Preview.
- Autosave.
- Manual save.
- Save as Asset.
- Template management for Super Admin.

## 1.4 Out of Scope for Initial V1

The following are explicitly not required to finish V1:

- Full Canva feature parity.
- Complex vector path editor.
- Pen-tool Bézier editing.
- Full Photoshop masking system.
- Advanced video editor.
- Multi-track professional video editing.
- Keyframe animation editor.
- Motion path editor.
- Collaborative real-time editing.
- AI-generated designs.
- AI image generation.
- Third-party stock media marketplaces.
- Advanced plugin marketplace.
- Full dynamic external-data widget ecosystem.

These may be added later without changing the core Design JSON contract.

---

# 2. Existing Screens Integration

The Designer must integrate into the current Lumina monorepo instead of operating as an isolated application.

Expected existing architecture:

```text
lumina/
├── apps/
│   ├── dashboard/      # Next.js dashboard
│   ├── api/            # NestJS API
│   ├── worker/         # BullMQ/media processing
│   └── player/         # Screen player
├── packages/
│   ├── types/
│   ├── ui/
│   └── config/
└── infra/
```

Recommended additions:

```text
lumina/
├── apps/
│   ├── dashboard/
│   │   └── src/features/designer/
│   ├── api/
│   │   └── src/modules/designs/
│   │   └── src/modules/templates/
│   ├── player/
│   │   └── src/features/design-runtime/
│   └── worker/
│       └── src/jobs/design-preview/
├── packages/
│   ├── types/
│   │   └── src/design/
│   ├── design-schema/
│   ├── design-runtime/
│   └── ui/
```

### Integration Rules

- Authentication comes from the existing Lumina session/JWT system.
- Tenant scope comes from the existing Organization/Tenant context.
- Existing media upload/storage services must be reused.
- Existing playlist system must reference customer design assets just like other playable media.
- Existing Player publication/offline mechanisms must be reused.
- Existing API conventions, error handling, logging, audit logging, and permissions must be followed.
- Avoid adding a second independent backend solely for the Designer.

---

# 3. Designer Architecture

The Designer is divided into five logical layers:

```text
┌───────────────────────────────────────────────┐
│               Designer UI                    │
│ Sidebar · Toolbar · Layers · Properties       │
├───────────────────────────────────────────────┤
│            Editor State Layer                │
│ Selection · History · Scenes · Timeline       │
├───────────────────────────────────────────────┤
│             Canvas Adapter                   │
│         Fabric.js integration only           │
├───────────────────────────────────────────────┤
│          Lumina Design Model                 │
│        Versioned Design JSON                 │
├───────────────────────────────────────────────┤
│            Backend / Storage                 │
│ API · PostgreSQL · S3/R2/MinIO · Worker      │
└───────────────────────────────────────────────┘
```

## Architectural Rule

Fabric.js must be hidden behind a local adapter layer.

Do not allow arbitrary Fabric objects to become the persisted public application schema.

Example:

```text
DesignerElement
      ↓
FabricAdapter.createObject()
      ↓
fabric.Textbox / fabric.Image / fabric.Rect
```

When saving:

```text
Fabric Object
      ↓
FabricAdapter.extractState()
      ↓
Lumina DesignElement JSON
      ↓
API
```

This makes future Fabric upgrades or player implementation changes possible without migrating every historical customer design.

---

# 4. Fabric.js Architecture

## 4.1 Fabric.js Responsibility

Fabric.js handles:

- Canvas rendering in the editor.
- Object selection.
- Transform controls.
- Drag.
- Resize.
- Rotate.
- Group selection.
- Visual object interaction.
- Basic text editing.
- Image rendering.
- Shape rendering.
- Zoom/pan.
- Canvas events.

Fabric.js is **not** responsible for:

- Tenant permissions.
- Template permissions.
- Database persistence.
- Version history.
- Timeline business logic.
- Player API contract.
- Dynamic variable resolution.
- SaaS authorization.

## 4.2 Fabric Adapter

Create:

```text
features/designer2/canvas/
├── FabricCanvasAdapter.ts
├── FabricObjectFactory.ts
└── FabricEventBridge.ts
```

> **Amendment (2026-08-25, post Phase 2 retrospective):** the originally-suggested split into
> separate `FabricSerializationAdapter.ts`/`FabricSelectionAdapter.ts`/`FabricGuidelines.ts` files
> proved over-granular in practice. Selection lives in `FabricEventBridge.ts` (bidirectional:
> Fabric→store via events, store→Fabric via `selectElements`); extraction back to `DesignElement`
> is inline in `FabricCanvasAdapter`/`FabricEventBridge` rather than a standalone serialization
> layer — the factory/adapter pair already owns both directions cleanly. Add `FabricGuidelines.ts`
> only when Phase 3's snapping/alignment work actually needs it, reusing
> `apps/dashboard/src/lib/canvasSnap.ts`'s existing math rather than writing new guideline logic.

The adapter must expose Lumina-level operations:

```ts
interface CanvasAdapter {
  loadScene(scene: DesignScene): Promise<void>;
  clear(): void;

  addElement(element: DesignElement): Promise<void>;
  updateElement(id: string, patch: Partial<DesignElement>): void;
  removeElement(id: string): void;

  selectElement(id: string): void;
  selectElements(ids: string[]): void;
  clearSelection(): void;

  bringForward(id: string): void;
  sendBackward(id: string): void;
  bringToFront(id: string): void;
  sendToBack(id: string): void;

  setZoom(value: number): void;
  fitToViewport(): void;

  exportSceneSnapshot(): Promise<Blob>;
}
```

## 4.3 Reference Project Usage

Open-source Fabric editors are references for:

- UX patterns.
- Fabric event handling.
- Keyboard shortcuts.
- History architecture.
- Canvas auto-resize.
- Image filter workflows.
- Layer panels.
- Guidelines/snapping.
- Selection behavior.
- Object cloning.
- Import/export patterns.

Do not:

- Copy the full application architecture.
- Import undocumented internal code directly.
- Couple Lumina storage to the reference project JSON.
- Keep third-party branding.
- Add external stock-media integrations just because the reference project includes them.
- Depend on abandoned packages without review.

Before borrowing code, verify:

- License.
- Dependency versions.
- Compatibility with the Fabric.js version chosen for Lumina.
- Security implications.
- Maintenance status.

---

# 5. Canvas & Layer Model

## 5.1 Canvas

Each design has a logical design resolution.

Examples:

```text
1920×1080  Landscape Full HD
1080×1920  Portrait Full HD
3840×2160  Landscape 4K
2160×3840  Portrait 4K
1080×1080  Square
```

The editor displays a scaled viewport. Object coordinates remain in logical design coordinates.

## 5.2 Safe Scaling

Player scaling:

```ts
scaleX = playerWidth / designWidth;
scaleY = playerHeight / designHeight;
```

Preferred behavior for signage:

- Preserve aspect ratio.
- Center the content.
- Support fit/contain by default.
- Allow future cover/crop behavior.
- Do not silently stretch designs with different aspect ratios.

## 5.3 Layer Structure

Each Scene contains ordered elements:

```text
Scene
├── Layer 1 — Background
├── Layer 2 — Video
├── Layer 3 — Product Image
├── Layer 4 — Offer Text
├── Layer 5 — Logo
└── Layer 6 — QR
```

The JSON element order is not the only source of truth. Persist an explicit `zIndex` or stable ordered array.

---

# 6. Element Types

Use a discriminated union.

```ts
type DesignElement =
  | TextElement
  | ImageElement
  | ShapeElement
  | VideoElement
  | QrElement;
```

Common properties:

```ts
interface BaseElement {
  id: string;
  type: string;
  name: string;

  x: number;
  y: number;
  width: number;
  height: number;

  rotation: number;
  opacity: number;

  visible: boolean;
  zIndex: number;

  editable: boolean;

  // Capability-based interaction flags — see §7's amendment. Replaces a single `locked`
  // boolean, which cannot express designer.md §7's own examples ("content editable, position
  // locked"). Defaults (a plain, non-template DesignAsset element): everything true.
  selectable: boolean;
  movable: boolean;
  resizable: boolean;
  deletable: boolean;

  animation?: ElementAnimation;

  dynamicBindings?: DynamicBinding[];
}
```

> **Amendment (2026-08-25):** `locked: boolean` (Phase 1/2's original field) is replaced by the
> four capability flags above. A Phase 2-style "fully locked" element is simply
> `{selectable:false, movable:false, resizable:false, deletable:false}`; a Template's "logo
> placeholder, content editable, position locked" is `{selectable:true, movable:false,
> resizable:false, deletable:false}` — expressible now, which the old boolean could not do. This
> also removes the need for a separate `TemplateLayerPolicy` shape (§7) for the
> movement/resize/delete axes — one capability model serves plain elements and
> Template-authored ones alike. `TemplateLayerPolicy` is narrowed to just the two axes that are
> genuinely Template-only concepts: `styleEditable` and `contentEditable` (see §7).

## Text

Support:

- Plain text.
- Font family.
- Font size.
- Font weight.
- Italic.
- Underline.
- Text color.
- Alignment.
- Line height.
- Letter spacing.
- Text direction.
- RTL/LTR.
- Dynamic variable tokens.

## Image

Support:

- Asset reference.
- Crop.
- Fit mode.
- Opacity.
- Basic filters.
- Border radius if technically safe.
- Flip horizontal/vertical.

## Shape

V1:

- Rectangle.
- Rounded rectangle.
- Circle.
- Ellipse.
- Triangle.
- Line.

Properties:

- Fill.
- Stroke.
- Stroke width.
- Radius where relevant.
- Opacity.

## QR

Properties:

- Static value.
- Dynamic value.
- Foreground color.
- Background color.
- Error correction level.
- Optional logo overlay later.

## Video

Video is a real visual layer.

Properties:

- Asset reference.
- Start offset.
- End offset optional.
- Mute.
- Volume.
- Loop.
- Object fit.
- Autoplay during scene.
- Poster/thumbnail reference.

---

# 7. Layer System

The layer panel should behave like a simplified Photoshop layer panel.

Required actions:

- Select layer.
- Rename layer.
- Show/hide.
- Lock/unlock.
- Reorder by drag and drop.
- Bring to front.
- Send to back.
- Move forward.
- Move backward.
- Duplicate.
- Delete.
- Multi-select.
- Group/ungroup may be deferred if necessary, but preferred if stable.

## Template Layer Permissions

`movable`/`resizable`/`deletable`/`selectable` now live directly on `BaseElement` (§6 amendment)
— every element has them, not just Template-managed ones. `TemplateLayerPolicy` narrows to the
two axes that are genuinely Template-specific (whether a customer may change a locked layer's
*content* or *style*, as opposed to its geometry):

```ts
interface TemplateLayerPolicy {
  styleEditable: boolean;
  contentEditable: boolean;
}
```

Examples (geometry via `BaseElement`, content/style via `TemplateLayerPolicy`):

- Company logo placeholder: `selectable:true, movable:false, resizable:false` +
  `contentEditable:true` (customer may replace the logo image, not move/resize it).
- Decorative background: `selectable:false, movable:false, resizable:false, deletable:false` — no
  `TemplateLayerPolicy` needed, nothing about it is customer-editable.
- Price field: `movable:false, resizable:false` + `contentEditable:true` (edit the text, not its
  position).
- QR placeholder: `movable:false, resizable:false` + `contentEditable:true` (edit the value, not
  the geometry).
- Product image: `movable:true, resizable:true` + `contentEditable:true` (fully replaceable and
  repositionable).

The UI must disable prohibited controls instead of relying only on backend validation.

The backend must still validate permissions because frontend controls are not a security boundary.

---

# 8. Properties Panel

The right-side properties panel changes based on selected element type.

> **Amendment (2026-08-25):** Properties Panel edits must never round-trip through a full
> document mutation per keystroke. Phase 2's canvas strategy is "clear and rebuild every element
> on any `document` change" (simplest correct thing for discrete add/delete/duplicate/reorder
> actions) — acceptable there, but a live numeric input (dragging an X/Y/opacity field) committing
> to the store on every keystroke would trigger a full canvas teardown+rebuild per keystroke,
> visibly janky and liable to drop focus/selection. Instead: property edits call
> `CanvasAdapter.updateElement(id, patch)` directly for immediate visual feedback (already exists
> in the adapter, unused until now), and only commit the change to the store (one `commit()`-
> wrapped undo step) on blur or after a debounce — the same capture-on-start/commit-on-end
> bracketing `LayoutCanvasPanel`/`ThemeCanvasPanel` already use for drag/resize via
> `useEditorHistory`'s `captureForHistory`/`commitCaptured`.

## Common Properties

- X.
- Y.
- Width.
- Height.
- Rotation.
- Opacity.
- Lock.
- Visible.
- Layer name.
- Animation.

## Text Properties

- Text.
- Font.
- Size.
- Weight.
- Color.
- Alignment.
- Direction.
- Line height.
- Letter spacing.
- Dynamic binding.

## Image Properties

- Replace.
- Crop.
- Fit.
- Filters.
- Opacity.
- Flip.

## Shape Properties

- Fill.
- Stroke.
- Stroke width.
- Corner radius.

## Video Properties

- Replace.
- Start time.
- End time.
- Loop.
- Mute.
- Volume.
- Fit.

## QR Properties

- Value.
- Dynamic variable.
- Error correction.
- Foreground.
- Background.

---

# 9. Asset Management

The word `Asset` currently represents media in the existing Lumina model. The Designer introduces an important distinction.

Recommended domain terminology:

```text
MediaAsset        = uploaded image/video/audio/font
DesignAsset       = customer-owned editable visual design
Template          = Super-Admin-managed reusable design
```

Avoid using one database model for all three concepts unless the existing schema already supports a clean type discriminator.

## Customer Asset Library

Customers can see only their tenant-owned media and designs.

Suggested tabs:

```text
My Designs
Images
Videos
Audio
Uploads
```

Designer actions:

- Upload image.
- Upload video.
- Browse tenant media.
- Insert existing media.
- Replace selected media.
- Save current design into My Designs.

## Asset References

Never store:

```json
{
  "src": "data:image/png;base64,..."
}
```

Store a flat reference:

```json
{
  "assetId": "ast_01..."
}
```

The server/player resolves the actual signed/CDN URL.

> **Amendment (2026-08-25):** the original draft of this section showed a nested
> `{assetId, source:{kind,id}}` shape, inconsistent with §18.2's own example JSON (which already
> uses a flat `assetId`) and with what Phase 2 actually implemented. Flattened to match — no
> element needs a non-`mediaAsset` source in V1, so the extra nesting bought nothing. Revisit only
> if a real non-asset source (e.g. an external URL) is ever needed.

---

# 10. Templates & Template Permissions

## 10.1 Template Ownership

Templates are platform content.

Only Super Admin can:

- Create Template.
- Modify Template source.
- Delete/archive Template.
- Publish/unpublish Template.
- Set Template categories.
- Set Template customer visibility.
- Define layer edit policies.
- Define dynamic fields.
- Create Template thumbnails.
- Create Template versions.

## 10.2 Template Visibility

A Template supports:

```ts
visibility:
  | "GLOBAL"
  | "SELECTED_TENANTS"
  | "TENANT_GROUP"
  | "HIDDEN";
```

For `SELECTED_TENANTS`, create an assignment table.

Example:

```text
Template
"Summer Offer"
    │
    ├── Customer A ✓
    ├── Customer B ✗
    └── Customer C ✓
```

## 10.3 Template Customer Rules

Customer can:

- View authorized Template.
- Preview authorized Template.
- Open authorized Template.
- Customize authorized Template.
- Save customized copy as a new Design Asset.

Customer cannot:

- Update Template.
- Delete Template.
- Change Template audience.
- Replace Template source version.
- Change platform-level locked layer rules.

---

# 11. Template → Asset Workflow

Required workflow:

```text
SUPER ADMIN
    │
    ▼
Create / Edit Template
    │
    ▼
Publish Template
    │
    ▼
Assign Visibility
    │
    ▼
CUSTOMER
    │
    ▼
Templates Page
    │
    ▼
Open Template
    │
    ▼
Create Temporary Working Copy
    │
    ▼
Make Allowed Changes
    │
    ▼
Save as Asset
    │
    ▼
New Customer Design Asset
```

## Critical Backend Rule

A customer `Save` request from Template mode must never issue an update against the Template record.

It creates:

```text
DesignAsset
tenantId = currentTenant.id
sourceTemplateId = template.id
sourceTemplateVersion = template.version
designJson = customizedDesign
```

Optional metadata:

```text
derivedFromTemplateId
derivedFromTemplateVersion
```

This supports analytics and future Template update notices without affecting the customer's copy.

---

# 12. Scenes & Timeline

## 12.1 Design Hierarchy

```text
Design
├── Scene 1
│   ├── Elements
│   └── Duration
├── Scene 2
│   ├── Elements
│   └── Duration
└── Scene 3
    ├── Elements
    └── Duration
```

## 12.2 Single Scene

Example:

```text
Scene 1 — 10 sec
Canvas
├── Background
├── Video
├── Logo
├── Text
└── QR
```

## 12.3 Multi Scene

```text
Scene 1 — 5 sec
Scene 2 — 7 sec
Scene 3 — 10 sec
```

## 12.4 Timeline V1

Timeline should initially control:

- Scene ordering.
- Scene duration.
- Element start delay.
- Element active duration if needed.
- Enter animation.
- Exit animation.

Do not build a full Adobe After Effects timeline in V1.

A reasonable V1 timeline:

```text
0s           5s           10s
|------------|------------|
Logo   [=================]
Title      [==============]
Product [=================]
QR              [=========]
```

Internally:

```ts
interface ElementTiming {
  startMs: number;
  endMs?: number;
}
```

---

# 13. Animation System

Animations must be semantic presets, not arbitrary executable JavaScript.

```ts
type AnimationPreset =
  | "none"
  | "fade"
  | "fade-up"
  | "fade-down"
  | "slide-left"
  | "slide-right"
  | "zoom-in"
  | "zoom-out"
  | "pulse";
```

Suggested structure:

```ts
interface ElementAnimation {
  enter?: {
    preset: AnimationPreset;
    durationMs: number;
    delayMs: number;
    easing?: string;
  };

  emphasis?: {
    preset: AnimationPreset;
    durationMs: number;
    delayMs: number;
    repeat?: number;
  };

  exit?: {
    preset: AnimationPreset;
    durationMs: number;
    delayMs: number;
    easing?: string;
  };
}
```

## Animation Runtime

Create a shared runtime mapping:

```text
Animation Preset
       ↓
Runtime implementation
       ↓
Editor Preview / Player
```

The Player and Designer Preview must use the same preset definition or shared runtime package to minimize visual mismatch.

---

# 14. Image Editing

V1 image functionality:

- Upload.
- Insert.
- Replace.
- Resize.
- Rotate.
- Crop.
- Object fit.
- Flip.
- Opacity.
- Basic image filters.

Suggested initial filters:

- Brightness.
- Contrast.
- Saturation.
- Grayscale.

Do not build:

- AI background removal in core V1.
- Complex masks.
- Photoshop-like layer masks.
- Advanced retouching.

Uploaded originals stay in object storage.

If a destructive derivative is necessary, store it as a new MediaAsset rather than overwriting the original file.

---

# 15. Video Handling

Video must be treated as a first-class layer.

Example:

```text
Background
    ↓
Video Layer
    ↓
Logo
    ↓
Text
    ↓
QR
```

## Upload Pipeline

Use existing media pipeline:

```text
Upload
  ↓
Object Storage
  ↓
Worker
  ↓
FFmpeg normalize/transcode
  ↓
Thumbnail/poster
  ↓
MediaAsset READY
```

## Designer Behavior

The Designer should not continuously decode several high-resolution videos unnecessarily.

While editing:

- Use poster frames where practical.
- Play selected video or active scene preview.
- Pause hidden/off-scene videos.
- Avoid loading every Scene's video simultaneously.

## Player Behavior

Player must:

- Preload upcoming video.
- Handle muted autoplay rules.
- Use normalized player-compatible format.
- Fall back to poster or error strategy on decode failure.
- Respect scene timing.
- Cache video locally when supported.

---

# 16. Text / RTL / Arabic / Hebrew

RTL is a V1 requirement, not a future enhancement.

Support:

- Arabic.
- Hebrew.
- English.
- Mixed RTL/LTR where technically possible.
- Text direction selection.
- Right/center/left alignment.
- Unicode.
- Web fonts that include required scripts.

## Text Model

```ts
interface TextElement extends BaseElement {
  type: "text";
  text: string;

  fontFamily: string;
  fontSize: number;
  fontWeight: number | string;
  fontStyle?: "normal" | "italic";

  fill: string;
  textAlign: "left" | "center" | "right";
  direction: "ltr" | "rtl";

  lineHeight?: number;
  charSpacing?: number;
}
```

## Testing Strings

Arabic:

```text
عرض الصيف الخاص
السعر 199 ₪
```

Hebrew:

```text
מבצע קיץ מיוחד
מחיר 199 ₪
```

Mixed:

```text
Samsung Galaxy S26 — السعر 3,999 ₪
```

Verify:

- Rendering in editor.
- Saved JSON.
- Reload.
- Preview.
- Player.
- Font loading offline.

---

# 17. QR & Dynamic Elements

## 17.1 QR

QR can be:

- Static text.
- URL.
- Phone.
- Wi-Fi payload later.
- Dynamic variable.

Examples:

```text
https://example.com/menu
{{business.website}}
{{offer.url}}
```

Do not store only a generated QR image.

Store the QR semantic value and generate/render it consistently.

## 17.2 Dynamic Variables V1

Dynamic variables are required in V1.

Examples:

```text
{{business.name}}
{{business.logo}}
{{business.phone}}
{{business.website}}
{{offer.title}}
{{offer.price}}
{{offer.oldPrice}}
{{offer.description}}
```

## Dynamic Variable Definition

Template:

```ts
interface DynamicFieldDefinition {
  key: string;
  label: string;
  type: "text" | "number" | "currency" | "image" | "url";
  required: boolean;
  defaultValue?: unknown;
}
```

Element binding:

```ts
interface DynamicBinding {
  property: string;
  variable: string;
  fallback?: string;
}
```

Example:

```json
{
  "property": "text",
  "variable": "offer.price",
  "fallback": "99"
}
```

## V1 Resolution Sources

Initial dynamic values may come from:

- Tenant/business profile.
- Template customization form.
- Design instance variables.

External API-driven widgets should remain Future Roadmap.

---

# 18. Design JSON Schema

## 18.1 Canonical Rule

Create a Lumina-owned schema.

Do **not** persist raw `canvas.toJSON()` as the permanent business contract.

Fabric-specific data may be stored under optional internal metadata temporarily, but all required player behavior must exist in the Lumina schema.

## 18.2 Example

```json
{
  "schemaVersion": 1,
  "id": "design_01H...",
  "name": "Summer Promotion",

  "canvas": {
    "width": 1920,
    "height": 1080,
    "backgroundColor": "#000000"
  },

  "settings": {
    "defaultSceneDurationMs": 10000
  },

  "variables": {
    "offer.title": "Summer Sale",
    "offer.price": "199"
  },

  "scenes": [
    {
      "id": "scene_01",
      "name": "Scene 1",
      "durationMs": 10000,
      "background": {
        "type": "color",
        "color": "#111111"
      },
      "elements": [
        {
          "id": "el_title",
          "type": "text",
          "name": "Offer Title",
          "x": 100,
          "y": 100,
          "width": 900,
          "height": 160,
          "rotation": 0,
          "opacity": 1,
          "visible": true,
          "locked": false,
          "editable": true,
          "zIndex": 10,

          "text": "{{offer.title}}",
          "fontFamily": "Noto Sans Arabic",
          "fontSize": 90,
          "fontWeight": 700,
          "fill": "#ffffff",
          "textAlign": "right",
          "direction": "rtl",

          "animation": {
            "enter": {
              "preset": "fade-up",
              "durationMs": 600,
              "delayMs": 100
            }
          }
        },

        {
          "id": "el_video",
          "type": "video",
          "name": "Background Video",
          "x": 0,
          "y": 0,
          "width": 1920,
          "height": 1080,
          "rotation": 0,
          "opacity": 1,
          "visible": true,
          "locked": true,
          "editable": false,
          "zIndex": 1,

          "assetId": "media_01...",
          "fit": "cover",
          "muted": true,
          "loop": true
        }
      ]
    }
  ]
}
```

## 18.3 Schema Validation

Create shared Zod schemas:

```text
packages/design-schema/
├── design.schema.ts
├── scene.schema.ts
├── element.schema.ts
├── animation.schema.ts
├── variables.schema.ts
└── index.ts
```

Validation happens:

- Before save in dashboard.
- At API boundary.
- Before publish.
- On Player load.

## 18.4 Schema Migrations

Every design includes:

```json
{
  "schemaVersion": 1
}
```

Create migration functions:

```ts
migrateDesignV1ToV2()
migrateDesignV2ToV3()
```

Never break old customer designs because a frontend implementation changed.

---

# 19. Database Changes

Exact ORM syntax should follow the current project ORM implementation, but recommended conceptual tables are below.

## 19.1 Design Asset

```text
design_assets
-------------
id
tenant_id
name
description
design_json JSONB
schema_version
thumbnail_asset_id
source_template_id NULL
source_template_version NULL
status
created_by
updated_by
created_at
updated_at
deleted_at NULL
```

## 19.2 Design Versions

```text
design_asset_versions
---------------------
id
design_asset_id
version_number
design_json JSONB
schema_version
created_by
created_at
reason
```

Do not create a version row for every mouse movement.

Create versions on:

- Explicit Save.
- Publish.
- Important restore point.
- Optional periodic snapshot.

## 19.3 Templates

```text
design_templates
----------------
id
name
description
category
design_json JSONB
schema_version
thumbnail_asset_id
visibility
status
version_number
created_by
updated_by
created_at
updated_at
published_at
```

## 19.4 Template Tenant Assignments

```text
design_template_tenants
-----------------------
template_id
tenant_id
created_at
```

Unique:

```text
(template_id, tenant_id)
```

## 19.5 Template Versions

```text
design_template_versions
------------------------
id
template_id
version_number
design_json
schema_version
created_by
created_at
```

## 19.6 Optional Draft/Autosave Table

Option A: Keep autosave state in Redis.

Option B:

```text
design_drafts
-------------
id
tenant_id
user_id
design_asset_id NULL
template_id NULL
draft_json
updated_at
expires_at
```

Recommended V1:

- Browser local recovery + debounced backend draft.
- Do not pollute permanent version history with autosave.

---

# 20. Storage Strategy

## PostgreSQL

Stores:

- Design metadata.
- Template metadata.
- Design JSON.
- Template JSON.
- Permissions.
- Version records.
- Dynamic values.
- References to media.

## S3 / R2 / MinIO

Stores:

- Images.
- Videos.
- Audio.
- Font files if self-hosted.
- Thumbnails.
- Exported previews.
- Optional rendered static snapshots.

## CDN

Player receives cache-friendly URLs.

## Security Rule

The client must not be able to provide an arbitrary storage key belonging to another tenant and have the API accept it.

Every referenced `assetId` must be authorized against:

- Current tenant ownership, or
- Platform/template-authorized shared media.

---

# 21. API Endpoints

Follow existing NestJS REST conventions.

Suggested API surface:

## Customer Designs

```text
GET    /designs
POST   /designs
GET    /designs/:id
PATCH  /designs/:id
DELETE /designs/:id

POST   /designs/:id/duplicate
POST   /designs/:id/restore/:versionId
GET    /designs/:id/versions
POST   /designs/:id/preview
```

## Autosave Draft

```text
PUT    /design-drafts/:draftId
GET    /design-drafts/:draftId
DELETE /design-drafts/:draftId
```

## Templates — Customer

```text
GET  /templates
GET  /templates/:id
POST /templates/:id/create-design
```

`create-design` must clone the Template into a new tenant-owned Design Asset.

Alternative UI flow may use a draft before final save, but the API must guarantee source Template immutability.

## Templates — Super Admin

```text
GET    /admin/templates
POST   /admin/templates
GET    /admin/templates/:id
PATCH  /admin/templates/:id
DELETE /admin/templates/:id

POST   /admin/templates/:id/publish
POST   /admin/templates/:id/unpublish

PUT    /admin/templates/:id/tenant-access
GET    /admin/templates/:id/tenant-access
```

## Media

Reuse existing media endpoints where possible:

```text
POST /media/upload
GET  /media
GET  /media/:id
```

## Player

Prefer a compiled playback payload:

```text
GET /player/screens/:screenId/manifest
```

The manifest can contain:

- Playlist.
- Design references.
- Design JSON or immutable version URLs.
- Media references.
- Checksums.
- Revision numbers.

---

# 22. Frontend Components

Recommended structure:

```text
apps/dashboard/src/features/designer/
├── components/
│   ├── DesignerShell.tsx
│   ├── DesignerTopBar.tsx
│   ├── DesignerSidebar.tsx
│   ├── CanvasViewport.tsx
│   ├── PropertiesPanel.tsx
│   ├── LayersPanel.tsx
│   ├── TimelinePanel.tsx
│   ├── SceneStrip.tsx
│   ├── ZoomControls.tsx
│   ├── SaveStatus.tsx
│   └── PreviewModal.tsx
│
├── panels/
│   ├── TextPanel.tsx
│   ├── ImagePanel.tsx
│   ├── VideoPanel.tsx
│   ├── ShapePanel.tsx
│   ├── QrPanel.tsx
│   ├── UploadPanel.tsx
│   └── TemplateVariablesPanel.tsx
│
├── properties/
│   ├── CommonProperties.tsx
│   ├── TextProperties.tsx
│   ├── ImageProperties.tsx
│   ├── VideoProperties.tsx
│   ├── ShapeProperties.tsx
│   └── QrProperties.tsx
│
├── canvas/
│   ├── FabricCanvasAdapter.ts
│   ├── FabricObjectFactory.ts
│   ├── FabricEventBridge.ts
│   └── FabricGuidelines.ts
│
├── state/
│   ├── designer.store.ts
│   ├── history.store.ts
│   └── selectors.ts
│
├── hooks/
│   ├── useDesigner.ts
│   ├── useAutosave.ts
│   ├── useHotkeys.ts
│   ├── useCanvasSelection.ts
│   └── useTemplatePolicy.ts
│
├── runtime/
│   ├── previewRuntime.ts
│   └── animations.ts
│
└── types/
```

## Suggested UI

```text
┌───────────────────────────────────────────────────────────────┐
│ Back | Name | Undo Redo | Canvas | Preview | Save            │
├───────────────┬──────────────────────────────┬────────────────┤
│ Templates     │                              │ Properties     │
│ Text          │                              │                │
│ Images        │           CANVAS             │ Position       │
│ Video         │                              │ Size           │
│ Shapes        │                              │ Style          │
│ QR            │                              │ Animation      │
│ Uploads       │                              │                │
├───────────────┴──────────────────────────────┴────────────────┤
│ Scenes / Timeline                                             │
├───────────────────────────────────────────────────────────────┤
│ Layers                                                        │
└───────────────────────────────────────────────────────────────┘
```

Final layout may combine Layers with the right panel depending on available width.

---

# 23. Player Integration

## 23.1 Important Rule

The Player should consume the **Lumina Design JSON**, not Fabric editor state.

Player responsibilities:

```text
Receive manifest
    ↓
Validate schema
    ↓
Resolve dynamic variables
    ↓
Resolve/cache media assets
    ↓
Render Scene
    ↓
Apply timeline
    ↓
Play animations/video
    ↓
Transition to next Scene
```

## 23.2 Rendering Strategy

For V1, choose one consistent runtime.

Recommended options:

### Option A — DOM/CSS/HTML Video Player Runtime

Render:

- Text as DOM.
- Image as `<img>`.
- Video as `<video>`.
- Shapes as DOM/SVG.
- QR as SVG/canvas.

Advantages:

- Better video behavior.
- Better text/RTL.
- Hardware-accelerated CSS animation.
- Player is not tied to Fabric.
- Easier accessibility/debugging.

### Option B — Fabric Runtime

Possible for rapid parity, but tighter coupling and video/text concerns may appear.

**Recommended architecture:** Editor = Fabric.js, Player = Lumina DOM/CSS runtime.

The Design JSON remains the bridge.

## 23.3 Player Design Cache

The Player should cache:

- Design JSON.
- Media files.
- Font files.
- Manifest revision.

Player must continue using the last valid published version if the server is temporarily unavailable.

## 23.4 Publish Immutability

A playlist should ideally reference a saved/versioned design revision.

Avoid a situation where an unfinished autosave instantly changes a live screen.

Use:

```text
Draft Design
   ↓ Save
Design Version
   ↓ Publish
Published Revision
   ↓
Player
```

---

# 24. Security & Tenant Isolation

Tenant isolation is mandatory at every API boundary.

Never rely on client-supplied `tenantId`.

Derive tenant from authenticated context.

Every customer query must effectively scope:

```text
WHERE tenant_id = authenticatedTenantId
```

## Media Authorization

When saving Design JSON, validate that every referenced MediaAsset is:

- Owned by current tenant, or
- Explicitly platform-shared through an authorized Template.

## Template Authorization

Customer template query must return only:

```text
GLOBAL
OR
SELECTED_TENANTS containing current tenant
OR
authorized group
```

## Server Validation

Server must reject:

- Customer update to Template.
- Cross-tenant design ID.
- Cross-tenant media references.
- Invalid dynamic variable injection.
- Unsupported schema version.
- Arbitrary executable animation payloads.
- HTML/script content inside text fields where not required.

## Audit Events

Audit at minimum:

- Template created.
- Template updated.
- Template published.
- Template tenant visibility changed.
- Design created from Template.
- Design deleted.
- Design published.

---

# 25. Super Admin vs Customer Permissions

| Capability | Super Admin | Customer |
|---|---:|---:|
| Create Template | Yes | Yes but save at his assets |
| Edit Template source | Yes | Yes but save at his assets the original file not changed |
| Delete/archive Template | Yes | No |
| Publish Template | Yes | No |
| Assign Template to tenants | Yes | No |
| Define locked layers | Yes | No |
| Define dynamic fields | Yes | No |
| Browse authorized Templates | Yes | Yes |
| Open Template | Yes | Yes |
| Modify original Template | Yes | No |
| Save Template customization as customer Asset | Test/Admin | Yes |
| Create design from scratch | Yes | Yes |
| Edit own tenant design | Admin tooling | Yes |
| Edit another tenant design | Only explicit platform support tooling | No |
| Use own media | Yes | Yes |
| Use platform-shared Template media | Yes | Yes, when authorized |
| Change tenant ownership manually | Controlled admin operation only | No |

---

# 26. Autosave / Versioning

## Autosave

Autosave should be debounced.

Recommended:

- Mark dirty immediately.
- Local recovery snapshot after meaningful changes.
- Backend autosave approximately 2–5 seconds after inactivity.
- Show status:

```text
Saving...
Saved
Offline — changes stored locally
Save failed
```

Do not send requests on every drag pixel.

## Draft Key

Draft identity may be:

```text
tenantId + userId + designId
```

or for Template customization:

```text
tenantId + userId + templateId + temporaryDraftId
```

## Manual Save

Manual Save:

- Validates full JSON.
- Creates/updates customer Design Asset.
- Creates version record if meaningful.
- Regenerates thumbnail asynchronously.

## Version Restore

V1 should support:

- Show recent manual versions.
- Restore a version.
- Restored version becomes a new current version rather than destroying history.

---

# 27. Undo/Redo

Undo/Redo is session-level editor history.

It is different from server versioning.

## History State

Track semantic editor commands where practical:

```text
AddElement
DeleteElement
UpdateElement
MoveElement
ResizeElement
ChangeLayerOrder
AddScene
DeleteScene
SceneDurationChange
```

Do not create a history entry for every `mousemove`.

Group transforms:

```text
mouseDown
many object:moving events
mouseUp
=> one MoveElement history entry
```

Recommended maximum history:

```text
50–100 steps
```

depending on memory profile.

Keyboard:

```text
Ctrl/Cmd + Z       Undo
Ctrl/Cmd + Shift+Z Redo
Ctrl/Cmd + Y       Redo optional
```

---

# 28. Export / Preview

## Preview

Preview is required.

Preview modes:

- Current Scene.
- Full Design from Scene 1.
- 16:9 viewport.
- Portrait viewport as relevant.
- Optional fullscreen.

Preview must use the same Lumina runtime behavior as the Player wherever possible.

## Export

V1 export priorities:

1. Player-ready Design JSON.
2. Thumbnail/preview PNG or WebP.
3. Optional static PNG export for single scene.

Do not block V1 on:

- MP4 rendering of animated designs.
- GIF export.
- PDF export.

Those can become worker-based future features.

---

# 29. Performance

## Canvas

- Do not rerender React tree on every Fabric object movement.
- Keep hot canvas transformations inside Fabric and sync state at controlled event boundaries.
- Lazy-load the Designer module.
- Load only active Scene into Fabric.
- Do not instantiate canvases for every Scene simultaneously.
- Reuse decoded images where possible.

## Images

- Use thumbnails in asset browser.
- Load full-resolution media when placed/required.
- Respect maximum upload limits.
- Generate optimized variants in worker if useful.

## Video

- Use poster images in media browser.
- Avoid autoplay of all videos during editing.
- Decode only active/preview video.

## JSON

- Keep JSON small.
- Use asset IDs rather than URLs with huge query strings if possible.
- Never embed binary data.
- Validate payload size.

## Autosave

- Debounce.
- Use optimistic UI.
- Abort superseded requests.
- Compare revision numbers to prevent stale writes.

---

# 30. Implementation Phases

Implementation runs from **Phase 0 through Phase 12**.

```text
Phase 0   Discovery & Contract
Phase 1   Designer Foundation
Phase 2   Core Canvas Elements
Phase 3   Layers & Properties
Phase 4   Media & Image Workflow
Phase 5   Templates & Permissions
Phase 6   Scenes & Timeline
Phase 7   Animation
Phase 8   Dynamic Variables + QR + RTL
Phase 9   Video Layers
Phase 10  Persistence + Autosave + Versions
Phase 11  Player Runtime Integration
Phase 12  Hardening, Testing & V1 Release
```

---

# 31. Developer Tasks per Phase

## Phase 0 — Discovery & Contract

### Goal

Freeze the V1 design contract before large UI implementation.

### Developer Tasks

- Inspect current Lumina dashboard conventions.
- Inspect existing media/asset models and upload API.
- Inspect playlist playable item types.
- Inspect Player manifest format.
- Confirm current ORM choice and migrations strategy.
- Install/evaluate target Fabric.js version in a spike branch.
- Run the Fabric editor reference project locally.
- Document reusable UX patterns.
- Define `DesignDocument` TypeScript type.
- Define Zod schema.
- Define `schemaVersion = 1`.
- Define element discriminated union.
- Define Template policy model.
- Define dynamic variable model.
- Define media reference strategy.
- Define Player rendering contract.
- Decide naming: `DesignAsset` vs existing `Asset`.
- Create architecture ADR.

### Deliverables

```text
packages/design-schema
docs/adr/designer-architecture.md
DesignDocument V1
Template permission contract
```

### Exit Criteria

- Design JSON can represent all V1 requested content.
- API and Player teams agree on schema.
- No raw Fabric JSON is required by Player.

---

## Phase 1 — Designer Foundation

### Goal

Create the integrated Designer page and Fabric abstraction.

### Developer Tasks

- Add Designer route.
- Add lazy-loaded client-only Canvas component.
- Initialize Fabric canvas.
- Build `FabricCanvasAdapter`.
- Implement viewport resize.
- Implement logical canvas resolution.
- Implement zoom.
- Implement pan.
- Implement selection.
- Add top toolbar shell.
- Add left sidebar shell.
- Add right properties shell.
- Add bottom Scenes/Timeline shell.
- Add save status placeholder.
- Add Zustand or equivalent editor state store.
- Add keyboard shortcut infrastructure.

### Acceptance

- Designer opens inside authenticated dashboard.
- Empty 1920×1080 design loads.
- Canvas fits available viewport.
- Zoom/pan works.
- Refresh does not break route.

---

## Phase 2 — Core Canvas Elements

### Goal

Create essential objects.

### Developer Tasks

Implement:

- Text.
- Rectangle.
- Circle.
- Triangle.
- Line.
- Image placeholder.
- QR placeholder object.

Operations:

- Add.
- Select.
- Move.
- Resize.
- Rotate.
- Duplicate.
- Delete.
- Copy.
- Paste.

Create object factory:

```text
DesignElement → FabricObject
```

Create reverse extraction:

```text
FabricObject → DesignElement changes
```

### Acceptance

- All basic element types survive save/reload in local test JSON.
- IDs remain stable after editing.
- Element coordinates map correctly to design coordinates.

---

## Phase 3 — Layers & Properties

### Goal

Provide professional object control.

### Developer Tasks

- Build LayersPanel.
- Drag reorder.
- Visibility.
- Lock (via the §6 capability flags — `selectable`/`movable`/`resizable`/`deletable` — not a
  single boolean).
- Rename.
- Bring forward/back.
- Multi-selection (native scope for this phase, not deferred further — see §7's amendment
  history; Fabric's own `ActiveSelection` plus `selectedElementIds: string[]`, already an array
  since Phase 1, extends naturally).
- Common properties panel.
- Text properties.
- Shape properties.
- X/Y/W/H numeric editing — via `CanvasAdapter.updateElement()` for live feedback, committed to
  the store on blur/debounce, per §8's amendment. Do not commit a full document mutation per
  keystroke.
- Opacity.
- Rotation.
- Alignment commands.
- Snapping/guidelines.
- Enforce capability flags in UI (disable/hide controls the current element's flags prohibit).

### Acceptance

- Canvas visual order equals Layers panel order.
- An element with `movable:false`/`resizable:false` cannot be moved/resized by mouse; one with
  `selectable:false` cannot be clicked into selection at all.
- Hidden elements do not render.
- Properties update the canvas immediately (via `updateElement`) and the store consistently (on
  commit) — dragging a numeric field must not visibly rebuild the canvas per keystroke.
- Multiple elements can be selected together (click+shift or marquee) and moved/deleted as a
  group.
- Undo/redo works for layer actions, including multi-element operations as a single step.

---

## Phase 4 — Media & Image Workflow

### Goal

Integrate existing customer media storage.

### Developer Tasks

> **Amendment (2026-08-25):** reuse `apps/dashboard/src/components/ImagePicker.tsx`,
> `AssetPicker.tsx`, and `VideoPicker.tsx` as-is — confirmed generic/framework-agnostic in the
> Phase 0 codebase audit, already handling upload/existing-media-browse/paste-to-upload/crop.
> **No new picker UI should be built for this phase.** The only new work is wiring designer2's
> Image/Video elements to open these existing pickers and bind the returned `assetId`.

- Wire the existing pickers into designer2's Image/Video element workflow (insert/replace).
- Filter image/video (already supported by `AssetPicker`'s type filtering).
- Image crop (reuse `CropEditor.tsx`).
- Fit modes.
- Basic filters (reuse `AdjustmentsEditor.tsx`).
- Thumbnail rendering (existing picker components already do this).
- Asset authorization check.
- Ensure Design JSON stores IDs/references, not Base64.
- Add missing worker thumbnail pipeline if required.

> **Amendment (2026-08-25, implementation):**
>
> - **Video stays deferred to Phase 9, not this phase.** `FabricObjectFactory` still hard-errors
>   on `type: 'video'` and the sidebar's Video button stays disabled with its existing "Phase 9"
>   label — nothing changed here. This phase's own Acceptance criteria only ever mention Image;
>   attempting partial Video wiring now would mean adding an element type the canvas cannot render
>   at all yet.
> - **`ImageElementSchema.crop`/`filters` (Phase 0 draft) are reshaped to match the reused
>   components' real data contracts** rather than kept as originally drafted. `crop` becomes flat
>   `cropZoom`/`cropOffsetX`/`cropOffsetY` (CropEditor.tsx's own `MediaCrop` shape); `filters`
>   becomes `adjustments: ThemeImageAdjustments` (imported from `@lumina/types`, the same type
>   every other placement-level image in this app already uses) so `AdjustmentsEditor.tsx` plugs
>   in with zero modification. This also means Image elements are ready to share
>   `mediaCropStyle`/`buildImageFilterCss` with the Player once it renders `<img>` elements per
>   §23.2 — one crop/adjustment runtime, not a second divergent one.
> - **Fabric's editor-canvas preview of `adjustments` is a best-effort approximation**, not exact:
>   brightness/contrast/saturation/hue map onto fabric's native filter classes (different math/
>   scale than CSS `filter()`), and vibrance/temperature/tint/exposure/duotone aren't approximated
>   further (no native fabric equivalent). The persisted values are always exact; only the live
>   canvas *preview* can drift from what `buildImageFilterCss` would render. Revisit once the
>   Player's DOM/CSS runtime (§23.2) makes an apples-to-apples comparison possible.
> - **"Asset authorization check" / "Cross-tenant asset injection is rejected" are only enforced
>   client-side for now**: the Image picker only ever lists/selects from the tenant-scoped
>   `assetsApi.list()`, so the UI cannot select another tenant's asset. There is no `/designs`
>   persistence endpoint yet (that's Phase 10) for a client to actually smuggle a foreign
>   `assetId` *into* — server-side re-validation of every `assetId` a saved Design JSON references
>   (per §20/§24) belongs in that endpoint when it's built, not here.
> - **Worker thumbnail pipeline**: confirmed already implemented (`apps/worker/src/processors/
>   media.processor.ts` handles both image and video thumbnailing) — nothing added.

### Acceptance

- Customer can upload and place image.
- Reload resolves same image.
- Cross-tenant asset injection is rejected.
- Browser list uses thumbnails.
- No Base64 media exists in persisted Design JSON.

---

## Phase 5 — Templates & Permissions

### Goal

Deliver Super Admin Template workflow.

### Developer Tasks

Backend:

- Create Template models.
- Template versions.
- Template tenant assignments.
- Admin CRUD endpoints.
- Customer authorized list endpoint.
- Clone-to-design endpoint.
- Audit logs.

Dashboard:

- Super Admin Templates page.
- Create Template.
- Edit Template.
- Publish/unpublish.
- Assign to all or selected tenants.
- Template categories.
- Define layer policies.
- Customer Templates gallery.
- Template preview.
- Customize action.

### Mandatory Workflow

```text
Template
   ↓ open
Working copy
   ↓ customize
Save as Asset
   ↓
Tenant-owned DesignAsset
```

> **Amendment (2026-08-25, implementation):**
>
> - **`design_assets` (§19.1) is built now, minimally, not deferred whole to Phase 10.** This
>   phase's own acceptance criteria ("Saving creates new tenant DesignAsset") need at least one
>   real row to create. Only `create` (via the Template clone path) plus tenant-scoped `GET
>   /designs`/`GET /designs/:id` exist — no PATCH/DELETE/duplicate/versions/autosave-draft, no
>   generic "create from scratch" endpoint. Phase 10 owns all of that.
> - **No draft-vs-published content split on `DesignTemplate`.** `designJson` is simply "whatever
>   Super Admin last saved," live the moment `status` is `PUBLISHED` — matching how the existing
>   Theme model (no publish concept at all) already works in this codebase. `publish()` still
>   snapshots an immutable `DesignTemplateVersion` row and bumps `versionNumber` each time, for
>   future admin history/rollback tooling, but customer reads/clones always go through the live
>   `DesignTemplate` row, not that snapshot. `sourceTemplateVersion` on a cloned DesignAsset is
>   just `DesignTemplate.versionNumber` at clone time, not a fetched version row.
> - **`TENANT_GROUP` (§10.2) is not in `DesignTemplateVisibility`.** No tenant-grouping concept
>   exists anywhere else in this schema (Organization is the only tenant unit) — add it if such a
>   feature is ever actually built, rather than modeling a group of one now.
> - **"Delete/archive Template" (§25) is one action, `ARCHIVED` status, never a hard delete** — a
>   DesignAsset's `sourceTemplateId` must keep resolving for every design already cloned from it.
> - **Template *content* authoring reuses designer2 itself**, via `/designer2?templateId=...`
>   (Super Admin only), rather than a second, separate design-authoring surface — one shared
>   canvas editor for both Templates and customer designs, per this app's existing "one editor
>   page" convention (see the Layout/Theme editor unification). The Super Admin `/admin/templates`
>   page (new — the pre-existing `/templates` route is unrelated legacy Layout/Theme content) only
>   owns metadata: name/description/category/visibility/tenant-assignment/publish state. "Define
>   layer policies" (§7's `TemplateLayerPolicy`) is two extra toggles in designer2's own
>   PropertiesPanel, shown only in this authoring mode.
> - **A cross-tenant "list every organization" endpoint was added** (`GET /org/all`, Super Admin
>   only) — needed for the tenant-assignment picker; didn't exist anywhere before this.
> - **The customer-facing gallery lives inside designer2's own sidebar** (its Templates button,
>   previously a disabled placeholder), not a separate top-level page — "Use this template" clones
>   into a DesignAsset and shows a confirmation. It cannot open that DesignAsset back into the
>   editor afterward — no design-loading route exists yet for customer designs (Phase 10).

### Acceptance

- Customer cannot PATCH Template endpoint.
- Unauthorized tenant cannot see/retrieve Template.
- Authorized customer can customize.
- Saving creates new tenant DesignAsset.
- Original Template checksum/design remains unchanged.

---

## Phase 6 — Scenes & Timeline

### Goal

Support multi-scene signage designs.

### Developer Tasks

- Add Scene type.
- Scene add.
- Duplicate Scene.
- Rename Scene.
- Delete Scene.
- Reorder Scene.
- Scene thumbnail.
- Scene duration.
- Scene strip/timeline UI.
- Load only active Scene into Fabric.
- Preserve inactive Scene state in Design store.
- Full-design preview loop.

### Acceptance

- Single Scene works.
- Multi Scene works.
- Scene duration respected in preview.
- Reordering persists.
- Switching Scenes does not lose changes.

---

## Phase 7 — Animation

### Goal

Add safe preset-based motion.

### Developer Tasks

- Define shared animation presets.
- Add enter animation controls.
- Add exit animation controls.
- Add delay/duration.
- Add optional emphasis preset.
- Build preview runtime.
- Ensure editor and player runtime use shared definitions.
- Prevent invalid animation values at API schema level.

### Acceptance

- Animation preview is repeatable.
- Saved animation reloads correctly.
- No arbitrary JS is stored/executed.
- Player test runtime matches Designer preview closely.

---

## Phase 8 — Dynamic Variables + QR + RTL

### Goal

Make Templates useful for real customer personalization.

### Developer Tasks

Dynamic:

- Variable definition UI for Super Admin.
- Bind text property.
- Bind QR value.
- Bind image source where supported.
- Customer variable customization UI.
- Fallback values.
- Variable resolver.

QR:

- QR element renderer.
- Static/dynamic mode.
- Color controls.

RTL:

- Text direction.
- Arabic fonts.
- Hebrew fonts.
- Mixed-content testing.
- RTL properties panel behavior.
- Designer UI locale compatibility.

> **Amendment (2026-08-25):** Fabric's `Textbox` has no real bidirectional text shaping — it can
> render Arabic/Hebrew glyphs but not correctly lay out mixed-direction or multi-line
> RTL/LTR content the way a browser's native text stack does (which is exactly what
> `ThemeCanvasPanel`'s existing DOM-based text rendering already gets for free). Decision: text
> elements use a **hybrid rendering approach** — Fabric still owns the element's position/size/
> selection/transform handling on canvas, but the actual glyph rendering for `TextElement` is a
> DOM overlay (an absolutely-positioned `<div dir="rtl|ltr|auto">`) synced to the Fabric object's
> live transform, rather than Fabric's own canvas-drawn text. Non-text elements (Shape/Image/QR)
> stay pure canvas — this only applies to text. Decide the concrete sync mechanism (transform
> matrix → CSS transform, or simpler position/rotation mirroring) before Phase 8 implementation
> starts, not during it.

### Acceptance

- `{{business.name}}` resolves.
- `{{offer.price}}` resolves.
- QR updates when variable changes.
- Arabic/Hebrew survive save/reload/player render.
- No reversed or corrupted Unicode text.

---

## Phase 9 — Video Layers

### Goal

Render real video within scene composition.

### Developer Tasks

- Video element type.
- Insert from MediaAsset.
- Video poster.
- Play/pause selection behavior.
- Mute/volume.
- Loop.
- Fit mode.
- Start offset.
- Optional end offset.
- Scene timing integration.
- Normalized video validation.
- Player video component.
- Preload strategy.

### Acceptance

- Video may sit behind text/logo/QR.
- Overlay elements remain synchronized.
- Video respects layer order.
- Player runs normalized video.
- Design reload preserves video settings.

---

## Phase 10 — Persistence + Autosave + Versions

### Goal

Make editing reliable.

### Developer Tasks

- Create Design API persistence.
- Implement revision field / optimistic concurrency.
- Implement debounced autosave.
- Implement local recovery snapshot.
- Manual Save.
- Version records.
- Restore version.
- Save status indicator.
- Handle offline save error.
- Handle stale revision conflict.

### Acceptance

- Browser crash/reload can recover recent work.
- Multiple rapid edits do not flood API.
- Manual saves create version records.
- Old version can be restored.
- Stale client cannot silently overwrite newer server revision.

---

## Phase 11 — Player Runtime Integration

### Goal

Play Design Assets on actual screens.

### Developer Tasks

- Build shared `design-runtime`.
- DOM/CSS rendering for text/image/shape/video/QR.
- Variable resolution.
- Timeline scheduling.
- Animation runtime.
- Scene transitions.
- Manifest integration.
- Asset preloading.
- Offline cache.
- Cache revision invalidation.
- Error fallback.
- Proof-of-play linkage.

### Acceptance

- Published design plays on web player.
- Same design plays after reload.
- Multi Scene timing works.
- Video overlays work.
- Arabic/Hebrew works.
- Internet loss after cache does not produce blank screen.
- Updated published revision replaces old cache correctly.

---

## Phase 12 — Hardening, Testing & V1 Release

### Goal

Prepare production release.

### Developer Tasks

- Performance profiling.
- Memory leak testing.
- Long playback soak test.
- Large-design testing.
- Error boundaries.
- API rate limits.
- Upload abuse controls.
- Authorization penetration tests.
- Cross-tenant tests.
- Schema migration test.
- Browser compatibility.
- Android/WebView player compatibility.
- RTL regression.
- Documentation.
- Seed sample Templates.
- Feature flags.
- Metrics/telemetry.

### V1 Exit

Designer is production-ready only when all Definition of Done requirements below pass.

---

# 32. Acceptance Criteria

## Designer Core

- User can create 1920×1080 design.
- User can create portrait design.
- Text/image/shape/QR/video layers work.
- Layer order is persistent.
- Locked layers cannot be modified by prohibited actions.
- Undo/redo works.
- Autosave works.
- Manual save works.
- Reload reproduces design.

## Templates

- Super Admin can create Template.
- Super Admin can limit Template to Customer A only.
- Customer B cannot access it.
- Customer A can open it.
- Customer A can edit permitted fields.
- Customer A saves a new Design Asset.
- Source Template remains unchanged.

## Scenes

- Single Scene.
- At least three Scenes.
- Custom duration.
- Reordering.
- Full preview.

## Dynamic

- Static text.
- Dynamic text.
- Dynamic QR.
- Tenant/business values.
- Template customization values.

## Languages

- English.
- Arabic.
- Hebrew.
- RTL.
- LTR.

## Player

- Reads Design JSON.
- Plays scene sequence.
- Renders media.
- Renders video layer.
- Renders overlays.
- Runs basic animation.
- Runs cached design offline.

---

# 33. Testing

## 33.1 Unit Tests

Test:

- Schema validation.
- Design migrations.
- Element factory.
- Dynamic variable resolver.
- Template permission evaluator.
- Animation presets.
- Scene duration math.
- Asset authorization.
- Version conflict logic.

## 33.2 API Integration Tests

Must include:

- Tenant A cannot read Tenant B design.
- Tenant A cannot use Tenant B asset.
- Customer cannot modify Template.
- Unassigned Template returns forbidden/not found.
- Assigned Template clones successfully.
- Clone belongs to current tenant.
- Invalid Design JSON rejected.
- Unsupported schema rejected.
- Super Admin access passes.

## 33.3 Designer E2E

Use Playwright or current project standard.

Flows:

1. Create blank design.
2. Add text.
3. Add image.
4. Add shape.
5. Add QR.
6. Add video.
7. Reorder layers.
8. Add Scene.
9. Add animation.
10. Save.
11. Reload.
12. Preview.

Template E2E:

1. Super Admin creates Template.
2. Assigns Customer A.
3. Customer A opens.
4. Customer edits allowed fields.
5. Customer cannot edit locked background.
6. Save as Asset.
7. Verify source Template unchanged.

## 33.4 RTL Tests

Screenshot regression for:

- Arabic single line.
- Arabic multiline.
- Hebrew single line.
- Hebrew multiline.
- Mixed English/Arabic numbers.
- Alignment.
- Dynamic variable injection.

## 33.5 Player Soak Testing

Run continuously:

- 1 hour development.
- 8 hours staging.
- 24–72 hours pre-release on target devices.

Monitor:

- Memory.
- CPU.
- Video decoder.
- Scene transitions.
- Cache.
- WebSocket reconnection.
- Blank frame frequency.

## 33.6 Performance Test Designs

Create fixtures:

```text
Small:
10 elements
1 image
0 video

Medium:
40 elements
5 images
1 video
3 scenes

Heavy:
100 elements
15 images
2 videos
6 scenes
```

V1 should optimize for realistic signage, not pathological Photoshop-sized projects.

---

# 34. What NOT to Build

Do not delay V1 for the following:

- Canva clone completeness.
- Photoshop clone completeness.
- Illustrator pen tool.
- Advanced vector path editing.
- Real-time multi-user collaboration.
- Comments/mentions.
- AI design generation.
- AI image generation.
- AI background removal.
- Stock photo marketplace.
- Complex transitions between every element.
- Arbitrary JavaScript animations.
- User-installed plugins.
- Embedded third-party web pages inside arbitrary layers.
- Full HTML editor.
- Advanced spreadsheet/data-grid designer.
- After Effects style keyframes.
- Professional audio mixer.
- Video trimming/transcoding UI beyond basic start/end.
- MP4 render/export.
- GIF render/export.
- Unlimited custom external API scripting.

If a feature is not required for a customer to create, customize, save, and play a signage design, it should not block V1.

---

# 35. Future Extensions

## Phase After V1 — Widgets

Add semantic elements:

```text
Clock
Date
Weather
Prayer Times
Currency
RSS / News ticker
Social feed
Flight schedule
Queue number
Countdown
Web/API data
```

Each Widget should be a typed element rather than arbitrary JavaScript.

## Dynamic Data Framework

Future:

```text
Data Source
  ↓
Field Mapping
  ↓
Variable
  ↓
Design Element
```

Data sources:

- REST API.
- Database.
- Google Sheets.
- POS integration.
- Product catalog.
- Weather API.
- Currency API.
- Flight API.

## AI

AI must use the existing schema rather than invent a separate rendering system.

Future AI features:

- Generate design from prompt.
- Choose Template based on business type.
- Automatically fill Template variables.
- Rewrite promotional text.
- Translate design text.
- Resize layout for portrait/landscape.
- Generate visual variations.
- Recommend color/font combinations.
- Generate product campaign from catalog.
- Auto-create scenes from a promotion.

Desired architecture:

```text
AI
 ↓
Produces / modifies Design JSON
 ↓
Same validation
 ↓
Same Designer
 ↓
Same Player
```

## Smart Templates

Templates can later expose controlled parameters:

```text
Primary Color
Secondary Color
Business Logo
Offer Title
Price
Product Image
CTA
QR URL
```

A simple customer may edit these using a form without opening the full Designer.

## Responsive Variants

Future design:

```text
Campaign
├── 1920×1080
├── 1080×1920
└── 1080×1080
```

Shared content variables can populate all variants.

## Collaboration

Later:

- Shared editing.
- Presence.
- Comments.
- Approval workflow.
- Draft/published review.

Do not include this complexity in V1.

---

# V1 Definition of Done

V1 is complete only when all conditions below are true.

## Architecture

- [ ] Fabric.js is isolated behind a Lumina adapter.
- [ ] Lumina Design JSON V1 is documented.
- [ ] Zod/shared schema validates Design JSON.
- [ ] Player does not require raw Fabric serialization.
- [ ] Design schema has versioning/migration strategy.

## Core Designer

- [ ] Canvas works in existing Dashboard.
- [ ] Landscape and portrait formats work.
- [ ] Text layer.
- [ ] Image layer.
- [ ] Shape layer.
- [ ] QR layer.
- [ ] Video layer.
- [ ] Background.
- [ ] Move/resize/rotate.
- [ ] Photoshop-style layer ordering.
- [ ] Visibility.
- [ ] Lock.
- [ ] Duplicate/delete.
- [ ] Copy/paste.
- [ ] Properties panel.
- [ ] Zoom/pan.
- [ ] Snapping/guidelines.
- [ ] Undo/redo.

## Scenes / Timeline

- [ ] Single Scene.
- [ ] Multi Scene.
- [ ] Scene duration.
- [ ] Reorder Scenes.
- [ ] Element timing.
- [ ] Full design preview.

## Animation

- [ ] Enter presets.
- [ ] Exit presets.
- [ ] Delay.
- [ ] Duration.
- [ ] Same behavior in Player.

## Templates

- [ ] Super Admin create.
- [ ] Super Admin edit.
- [ ] Super Admin publish.
- [ ] Global Template.
- [ ] Customer-specific Template.
- [ ] Locked/editable layer rules.
- [ ] Dynamic fields.
- [ ] Customer customization.
- [ ] Save as new Design Asset.
- [ ] Source Template immutable to customer.

## Tenant Security

- [ ] Designs are tenant-scoped.
- [ ] Media is tenant-scoped.
- [ ] Template visibility is enforced server-side.
- [ ] Cross-tenant references are rejected.
- [ ] Audit logging exists for important Template events.

## Languages

- [ ] English.
- [ ] Arabic.
- [ ] Hebrew.
- [ ] RTL.
- [ ] LTR.
- [ ] Player parity.

## Reliability

- [ ] Autosave.
- [ ] Local draft recovery.
- [ ] Manual version save.
- [ ] Version restore.
- [ ] Optimistic concurrency.
- [ ] Player offline cache.
- [ ] Player survives reconnection.

## Testing

- [ ] Unit tests.
- [ ] API tenant isolation tests.
- [ ] E2E Designer tests.
- [ ] Template permission tests.
- [ ] RTL screenshot tests.
- [ ] Player soak test.
- [ ] Target Android/WebView test.

---

# Recommended Technical Decisions Summary

```text
Canvas engine:
Fabric.js

UI:
Existing Next.js Dashboard + React

Editor state:
Zustand or the state library already standardized in Lumina

Persistence:
Lumina-owned Design JSON

Schema:
TypeScript + Zod shared package

Database:
PostgreSQL / JSONB for design documents and relational permission metadata

Binary media:
Existing S3-compatible object storage

Template ownership:
Platform / Super Admin

Customer result:
Tenant-owned DesignAsset

Template modification:
Super Admin only

Template customer customization:
Clone / working copy → Save as Asset

Player:
Lumina runtime consuming Design JSON

Player rendering recommendation:
DOM + CSS + HTML Video + SVG/QR

Offline:
Manifest + Design JSON + asset cache

Animation:
Whitelisted semantic presets

Dynamic variables:
V1

RTL:
V1
```

---

# Suggested First Pull Requests

To keep implementation reviewable, avoid one giant Designer branch.

Recommended PR sequence:

```text
PR 01 — Design schema + ADR
PR 02 — Fabric canvas foundation
PR 03 — Text/shapes + transforms
PR 04 — Layers + properties + history
PR 05 — Media/image integration
PR 06 — Templates backend + permissions
PR 07 — Templates dashboard UX
PR 08 — Scenes + timeline
PR 09 — Animation runtime
PR 10 — Dynamic variables + QR + RTL
PR 11 — Video layer
PR 12 — Autosave + versions
PR 13 — Player design runtime
PR 14 — Offline cache + publish integration
PR 15 — V1 hardening/tests
```

Each PR should include:

- Tests.
- No unrelated refactors.
- Schema changes documented.
- Migration if DB changes.
- Screenshots/video for visible behavior.
- Feature flag where production exposure is unsafe.

---

# Reference Projects and Documentation

These are engineering references, not product dependencies unless separately approved.

## Fabric.js

- https://fabricjs.com/
- https://github.com/fabricjs/fabric.js

Use Fabric.js as the editor canvas engine.

## Fabric Canvas Editor Reference

- https://github.com/onerkiz/fabric-canvas-editor

Useful reference areas:

- React/Fabric integration.
- Shape tools.
- Text controls.
- Image workflow.
- History.
- Keyboard shortcuts.
- Layer management.
- Canvas resizing.
- Export patterns.

Review dependency versions before adapting code.

## Additional Fabric Design Editor Reference

- https://github.com/ajpgtech/design-editor

Useful for studying:

- Lock/unlock.
- Crop.
- Zoom/pan.
- Context menu.
- Animation patterns.
- Undo/redo.
- Guidelines.
- Server-side rendering concepts.

Do not adopt its domain model as the Lumina Design JSON.

---

# Final Architecture Principle

The long-term value of Spark Screens Designer is not the Fabric canvas itself.

The long-term value is the **Lumina Design Model**.

```text
                 Spark Screens Designer
                         │
                         │ edits
                         ▼
                  Lumina Design JSON
                         │
       ┌─────────────────┼──────────────────┐
       │                 │                  │
       ▼                 ▼                  ▼
   Templates          Customer           AI / Widgets
                      Designs              Future
       │                 │                  │
       └─────────────────┼──────────────────┘
                         │
                         ▼
                      Player
                         │
                         ▼
                      Screens
```

Fabric.js is the best current editing engine for this architecture, but it must remain replaceable.

The Design JSON, permission model, media references, dynamic variables, scenes, timeline, and Player contract are the permanent product architecture.
