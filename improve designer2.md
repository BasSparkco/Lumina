I need you to perform a complete technical and UX review of the existing **Lumina Designer** implementation and then upgrade it from its current basic state into a modern, smooth, production-quality commercial digital-signage designer.

Do not treat this as a small bug-fix task.

The objective is to review the entire Designer architecture, Fabric.js integration, React/Next.js state flow, media insertion workflow, canvas rendering behavior, layers, transformations, selection controls, video handling, performance, and UX, then make the changes required to achieve a professional editing experience comparable in smoothness and usability to commercial signage editors such as OptiSigns.

The current Designer is functional, but it still feels primitive and has several visible architectural/UX problems.

## 1. First: Review Before Editing

Before making changes, inspect the complete Designer implementation and understand:

* How Fabric.js is initialized.
* How React/Next.js interacts with Fabric.
* How Designer state is stored.
* How canvas state is synchronized with React state.
* How objects are created and updated.
* How image and video objects are represented.
* How selection borders/control boxes are calculated.
* How object transforms are persisted.
* How layers are ordered and synchronized.
* How scenes interact with the canvas.
* How autosave is triggered.
* Whether every Fabric event is causing React rerenders or canvas reconstruction.
* Whether the canvas or active scene is being unnecessarily recreated.
* Whether object movement is being persisted continuously instead of only at meaningful boundaries.
* Whether the current implementation follows the architecture described in `designer.md`.

Also review the Fabric.js version and the libraries currently used around the Designer.

You may study well-designed Fabric.js editors and other suitable open-source libraries for implementation ideas.

If another maintained library would significantly improve a particular Designer capability, you may add it, but only when there is a clear architectural reason.

Do not replace the Lumina-owned Design JSON architecture with a third-party editor data model.

Fabric.js remains the main canvas engine unless your review identifies a serious technical reason that requires discussion before changing it.

---

# 2. Critical Problem: Image and Video Insertion

The current workflow is wrong.

Currently, when an Image or Video is inserted, the Designer first creates an empty rectangular placeholder/container and then inserts the media inside that rectangle.

This creates unnecessary empty space around the actual image/video.

I do not want this behavior.

## Required UX

When the user clicks:

* Image
* Video

show a media insertion choice such as:

```text
Image
├── Upload
└── Choose from Assets
```

and:

```text
Video
├── Upload
└── Choose from Assets
```

After the user selects or uploads media, insert the actual media element directly onto the canvas.

There should not be an unnecessary placeholder rectangle first.

## Required Geometry

The Fabric selection/control bounding box must correspond exactly to the visible media object.

For example:

```text
Actual image dimensions
┌───────────────────────┐
│                       │
│        IMAGE          │
│                       │
└───────────────────────┘
↑                       ↑
selection controls must match this exact boundary
```

Not:

```text
┌─────────────────────────────┐
│                             │
│    ┌───────────────────┐    │
│    │      IMAGE        │    │
│    └───────────────────┘    │
│                             │
└─────────────────────────────┘

incorrect unnecessary container
```

The same rule applies to Video.

If an image is inserted with aspect ratio:

```text
1200 × 600
```

its initial object geometry should preserve that aspect ratio.

If necessary, scale it down to fit inside the current canvas viewport, but do not distort it and do not surround it with a larger invisible object.

The same applies to portrait images and videos.

---

# 3. Media Insertion UX

Image and Video buttons should behave as media tools, not placeholder-object tools.

Recommended flow:

```text
Click Image
    ↓
Choose:
    Upload Image
    Browse Assets
    ↓
Select media
    ↓
Insert directly into current Scene
```

And:

```text
Click Video
    ↓
Choose:
    Upload Video
    Browse Assets
    ↓
Select media
    ↓
Insert directly into current Scene
```

Use the existing Lumina tenant Asset library.

Do not create duplicate media storage architecture.

Respect tenant isolation.

---

# 4. Major Performance Problem: Refreshing During Editing

The Designer currently appears to refresh/re-render far too often.

Moving, resizing, or changing an element can cause visible refresh behavior.

This is unacceptable for a production graphical editor.

Commercial editors such as OptiSigns allow objects to move smoothly and continuously.

I want the Lumina Designer to behave similarly.

## Investigate the Root Cause

Check carefully whether:

* React state is updated on every `object:moving` event.
* React causes the Fabric canvas component to rerender.
* The Fabric canvas is recreated.
* The current Scene is reloaded from JSON unnecessarily.
* `loadFromJSON()` is called during normal transforms.
* autosave causes the editor to reload.
* object state changes recreate Fabric objects.
* property panel state updates recreate canvas objects.
* queries/refetches invalidate the Designer state.
* URL/router state causes navigation refresh.
* React keys force component remounting.
* the Canvas component rerenders because large state objects are passed as props.
* Fabric event listeners are being registered repeatedly.
* video DOM elements are recreated.
* media URLs are refreshed/re-resolved unnecessarily.

This must be diagnosed architecturally rather than hidden with loading indicators.

## Required Performance Architecture

During:

* drag
* resize
* rotate
* continuous selection changes

Fabric should own the hot interaction path.

React should not rerender the entire Designer on every animation frame.

Example intended model:

```text
Pointer move
   ↓
Fabric object transforms locally
   ↓
60fps visual interaction
   ↓
mouse/pointer release
   ↓
commit final object transform
   ↓
update Designer state
   ↓
history entry
   ↓
debounced autosave
```

NOT:

```text
pointer movement
   ↓
React state update
   ↓
React render
   ↓
serialize
   ↓
reload canvas
   ↓
repeat
```

Use Fabric event boundaries appropriately:

```text
object:moving
object:scaling
object:rotating
```

may update local UI values where needed without rebuilding the canvas.

Then:

```text
object:modified
```

should normally commit the final meaningful state.

The final implementation should make object manipulation visually smooth.

---

# 5. Video Rotation Bug

There is currently a serious video transformation issue.

When a video layer is rotated, the visible video rotates outside the Fabric object's control rectangle/container.

This indicates that the visual video element and Fabric object's transformation matrix are not correctly synchronized.

Fix this properly.

The Video element must behave like every other canvas object.

When rotating:

```text
      /────────/
     / VIDEO  /
    /────────/
```

the selection controls must rotate with the actual video.

The video cannot remain independently positioned inside an unrotated wrapper.

Review:

* transform origin
* originX/originY
* left/top
* width/height
* scaleX/scaleY
* angle
* Fabric transform matrix
* DOM video overlay positioning, if a DOM overlay is currently used
* clipping
* viewport transform
* zoom
* object caching

If the current implementation overlays an HTML `<video>` element above a Fabric placeholder object, evaluate whether that architecture is causing the bug.

If so, refactor the Video layer architecture.

The video object and interaction geometry must remain synchronized for:

* move
* resize
* rotate
* zoom
* pan
* scene switching
* layer reordering

---

# 6. Layers Must Become Production Quality

Review the complete Layer system.

It should behave like a simplified Photoshop/Canva layer panel.

Required:

* Accurate z-order.
* Drag-and-drop reorder.
* Select.
* Rename.
* Show/hide.
* Lock/unlock.
* Duplicate.
* Delete.
* Bring forward.
* Send backward.
* Bring to front.
* Send to back.
* Multi-select where already supported or reasonably implementable.
* Canvas selection and Layers panel selection must remain synchronized.

Reordering Layers must immediately change actual canvas stacking order without rebuilding the entire scene.

---

# 7. Professional Transform Behavior

Review all transform controls.

Required behavior:

* Smooth drag.
* Smooth resize.
* Smooth rotate.
* Preserve aspect ratio where appropriate.
* Shift/keyboard modifier behavior if appropriate.
* Centered controls.
* Correct bounding box.
* Accurate hit testing.
* No invisible oversized objects.
* No jumping after pointer release.
* No geometry changes after Save.
* No geometry changes after reload.
* No difference between preview and saved position.

Add professional snapping/guidelines if the current implementation is weak.

Recommended snapping targets:

* Canvas center.
* Canvas edges.
* Other objects.
* Horizontal center.
* Vertical center.
* Equal edge alignment where practical.

Guidelines must not interfere with drag performance.

---

# 8. Selection UX

Improve selection behavior.

Expected:

* Click element → select.
* Click empty canvas → deselect.
* Shift-click → multi-select if supported.
* Selection outline exactly fits element.
* Selection handles are usable at different zoom levels.
* Locked elements cannot accidentally move.
* Hidden layers cannot be selected.
* Video behaves identically to image for selection geometry.
* Selecting via Layers panel selects same Fabric object.
* Selecting Fabric object updates Properties and Layers panels.

Avoid application-wide rerenders when selection changes.

---

# 9. Properties Panel

Review the Properties Panel.

Property changes should update the selected Fabric object efficiently.

For example changing:

* X
* Y
* Width
* Height
* Rotation
* Opacity
* Font size
* Text color

must not trigger:

```text
serialize whole design
→ destroy canvas
→ reload design
```

The selected Fabric object should be updated directly through the adapter, then the Designer model updated appropriately.

Maintain one authoritative Lumina Design state without creating two permanently divergent state trees.

---

# 10. React / Fabric Architecture Review

This area is extremely important.

Fabric is an imperative canvas engine.

React is declarative.

Do not attempt to make React rerender every Fabric interaction.

Review the architecture and establish a clear boundary.

Recommended pattern:

```text
React
│
├── Designer shell
├── panels
├── toolbar
├── layers
├── timeline
└── application state
       │
       ▼
Fabric Adapter
       │
       ▼
Fabric Canvas
```

The Fabric canvas instance should live persistently during editing.

Normal element movement must not reconstruct it.

Use refs and adapter commands where appropriate.

Avoid storing Fabric instances inside serializable application state.

Lumina Design JSON remains the persistence model.

---

# 11. State Management Review

Review whether the existing state management is appropriate.

The Designer should distinguish between:

### Persistent design state

```text
scenes
elements
properties
timing
animations
asset references
```

### Ephemeral editor UI state

```text
selectedElementIds
activePanel
zoom
viewport
hover state
drag state
open dialog
```

Do not persist temporary UI state into Design JSON.

Do not make a large global state object cause every component to rerender.

Use selectors/slices where appropriate.

If the current store architecture is inefficient, refactor it.

---

# 12. History / Undo / Redo

Review history implementation.

Undo/Redo should store semantic meaningful changes.

Dragging an object for two seconds must create one final history action, not hundreds.

Example:

```text
pointer down
→ 200 movement updates
→ pointer up
= one history entry
```

Same for:

* resize
* rotate
* sliders
* timeline dragging

History should not cause full canvas recreation unless truly necessary.

---

# 13. Autosave

Autosave must never make the Designer feel like a web form that refreshes after changes.

Review autosave.

Required:

```text
Edit
  ↓
mark dirty
  ↓
continue editing immediately
  ↓
debounced background save
```

Saving must not:

* reset selection
* change zoom
* recreate Fabric canvas
* reload current Scene
* reset video playback
* move elements
* display disruptive loading states

Use optimistic revision/concurrency protection without interfering with editor responsiveness.

---

# 14. Video Architecture Review

Please review Video layers beyond the rotation bug.

Video must be a first-class Designer element.

It must support:

* direct insertion
* actual media aspect ratio
* move
* resize
* rotate
* layer ordering
* opacity where supported
* fit mode
* loop
* mute
* start offset
* poster frame
* scene timing
* preview

If the implementation uses a Fabric proxy object plus separate DOM `<video>`, ensure that all transformations are mathematically synchronized.

If this approach remains fragile, consider a better Fabric-compatible implementation.

Do not solve rotation with one-off CSS patches that break zoom or scaling.

---

# 15. Image Architecture Review

Images should also be first-class objects.

Review:

* natural width/height
* aspect ratio
* cross-origin loading
* object caching
* crop behavior
* filters
* fit mode
* replacement
* asset resolution
* memory usage

Replacing an image should preserve object position/size where appropriate, but inserting a new image should initially respect the media's own aspect ratio.

---

# 16. Canvas Rendering Quality

Improve visual quality.

Review:

* devicePixelRatio / retina scaling
* object caching
* smoothing
* text clarity
* image clarity
* zoom behavior
* viewport scaling
* high-DPI screens

The editor should remain sharp without consuming unreasonable memory.

---

# 17. Keyboard and Professional Editor UX

Review/add standard shortcuts where safe.

Examples:

```text
Delete / Backspace    Delete
Ctrl/Cmd + Z          Undo
Ctrl/Cmd + Shift + Z  Redo
Ctrl/Cmd + C          Copy
Ctrl/Cmd + V          Paste
Ctrl/Cmd + D          Duplicate
Arrow keys            Nudge
Shift + Arrow         Larger nudge
Ctrl/Cmd + S          Save
```

Do not let browser shortcuts accidentally interfere with text editing.

---

# 18. Context Menu

If useful, add a professional right-click context menu:

```text
Copy
Paste
Duplicate
Delete
Lock
Bring Forward
Send Backward
Bring to Front
Send to Back
```

Only add it if it improves usability and does not introduce architectural complexity.

---

# 19. Libraries

You may introduce additional maintained libraries if they clearly improve the Designer.

Possible categories include:

* drag/drop for Layers
* keyboard shortcuts
* immutable history utilities
* QR rendering
* animation runtime
* color picker
* crop UI
* virtualization
* state selectors

However:

* Prefer small focused dependencies.
* Avoid importing an entire third-party editor framework.
* Avoid replacing Lumina's Design JSON.
* Verify licenses.
* Avoid abandoned libraries.
* Keep bundle size and maintenance burden reasonable.

Fabric.js remains the core Canvas engine.

---

# 20. Study Existing Professional Editors

Use competing products only as UX references.

Pay attention to editors such as:

* OptiSigns
* Canva
* Adobe Express
* commercial digital signage editors

Study concepts such as:

* instant object manipulation
* clean media insertion
* accurate transform boxes
* Layers workflow
* snapping
* Properties editing
* responsive panels
* minimal loading states
* smooth zoom
* timeline usability

Do not copy proprietary code or branding.

The goal is comparable UX quality, not visual imitation.

---

# 21. Commercial Signage Design Requirements

Remember that this is not a generic drawing application.

Lumina Designer must eventually support commercial advertising content such as:

```text
Product promotion
Restaurant menu
Retail offers
Digital menu boards
Room signage
Corporate screens
Wayfinding content
Promotional video compositions
Price advertising
QR campaigns
Multi-scene promotional presentations
```

Therefore optimize for:

* fast layout
* large text
* images
* videos
* overlays
* logos
* prices
* QR codes
* templates
* animations
* scenes
* portrait + landscape displays

---

# 22. Do Not Break Existing Product Architecture

Preserve:

* tenant isolation
* Template permissions
* Template → Customize → Save as Asset
* Design JSON architecture
* Scenes
* Timeline
* Dynamic variables
* Super Admin Template ownership
* customer Assets
* Player compatibility

If your proposed refactor requires Design JSON changes, introduce schema migrations and document them.

Do not silently make previously saved designs incompatible.

---

# 23. Backward Compatibility

Existing customer/template designs must continue to load.

If the current image/video object format contains old placeholder/container geometry, provide a migration or normalization strategy.

For example:

```text
Old media wrapper design
        ↓
migration / normalization
        ↓
real media element geometry
```

Do not force us to manually recreate existing Templates.

---

# 24. Testing Requirements

Add tests for the problems being fixed.

At minimum:

### Media insertion

* Insert landscape image.
* Bounding box exactly matches image geometry.
* Insert portrait image.
* Insert landscape video.
* Insert portrait video.
* No unnecessary wrapper padding.

### Transform

* Move.
* Resize.
* Rotate image.
* Rotate video.
* Selection stays synchronized.
* Save/reload preserves geometry.

### Performance

Verify normal object movement does not:

* recreate Canvas
* reload Scene
* issue repeated network requests
* cause route refresh
* issue autosave per pointer event

### Layers

* reorder
* lock
* hide
* select

### Autosave

* preserves current selection
* preserves zoom
* does not reload canvas

### Regression

* Template restrictions
* Dynamic variables
* RTL text
* Scenes
* Player JSON

---

# 25. Performance Instrumentation

During development, instrument the editor.

Measure:

* React render count.
* Canvas initialization count.
* Scene load count.
* autosave requests.
* object update frequency.
* video DOM creation/destruction.
* memory use.

The target during one continuous object drag should approximately be:

```text
Canvas initialization: 0
Scene reloads:         0
Network saves:         0
Fabric local updates:  many / smooth
Final state commits:   1
History entries:       1
```

After pointer release, debounced autosave may occur.

Remove unnecessary development instrumentation after validation or guard it behind development mode.

---

# 26. Expected End Result

I want the Designer to feel like a real commercial design application rather than a CRUD page containing a canvas.

The user should experience:

```text
click
drag
resize
rotate
reorder
type
change color
insert media
```

with immediate visual response.

There should be no visible page refreshing while normal editing takes place.

Images and Videos should behave like real graphical objects.

The actual object and its selection frame must remain synchronized.

Video rotation must work correctly.

Layers must feel reliable.

Autosave must be invisible during normal work.

The result should be suitable for professional advertising and digital signage creation.

---

# 27. Implementation Strategy

Do not rush into isolated fixes before understanding the root architecture.

First perform the review.

Then choose one of these approaches:

### Approach A — Existing architecture is fundamentally sound

Keep it and refactor the problematic sections incrementally.

### Approach B — Existing Designer integration is structurally wrong

If React/Fabric synchronization, media wrappers, history, or canvas lifecycle are fundamentally flawed, refactor that foundation before adding more features.

I prefer a correct foundation over preserving weak implementation simply because it already exists.

---

# 28. Work Plan Option

This task touches many parts of the Designer.

If you believe implementing everything in one pass creates unnecessary risk, **do not attempt a giant uncontrolled rewrite**.

Instead, create a detailed implementation plan first.

You may create a file such as:

```text
docs/designer/designer_modernization_plan.md
```

or another appropriate location following the repository conventions.

The plan should divide work into clear milestones such as:

```text
M0 — Current architecture audit
M1 — Canvas lifecycle/performance
M2 — Media insertion architecture
M3 — Image/video transformation correctness
M4 — Layers and selection
M5 — Properties/state synchronization
M6 — History/autosave
M7 — Editor UX improvements
M8 — Testing/performance hardening
```

For each milestone include:

* current problem
* root cause
* files involved
* architectural change
* implementation tasks
* tests
* acceptance criteria
* migration/backward compatibility considerations

If you create the plan first, stop after producing the reviewed plan and report your findings before implementation, unless the changes are clearly small and safe enough to proceed directly.

---

# 29. Important Review Question

Before implementation, explicitly answer:

1. Why is the Designer currently visibly refreshing during editing?
2. Is the Fabric canvas being recreated or reloaded?
3. Is React state being updated too aggressively?
4. Why do Image/Video objects have a larger empty wrapper?
5. Why does Video rotation diverge from the selection box?
6. Is the current Video implementation using a DOM overlay?
7. Is the current Design JSON sufficiently independent from Fabric?
8. Are Layers backed by the same authoritative element order as the Canvas?
9. Is autosave interfering with editing?
10. Which parts should be refactored versus preserved?

Do not guess.

Trace the implementation and provide code-level evidence.

---

# 30. Final Deliverable

The final implementation/review should leave Lumina with a Designer architecture that is:

* smooth
* responsive
* maintainable
* commercial-quality
* Fabric.js-based
* tenant-safe
* compatible with Templates and Assets
* compatible with existing Designs
* ready for future expansion

The priority is not adding more buttons.

The priority is making the **core Designer interaction model correct, fast, and professional**.
