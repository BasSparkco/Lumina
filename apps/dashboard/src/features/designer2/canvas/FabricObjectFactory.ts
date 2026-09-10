/**
 * designer.md §4.2 — DesignElement → fabric.Object construction.
 *
 * Phase 2 scope: Text, Shape (all 6 ShapeKindSchema kinds), and placeholder Image/QR objects
 * (no real asset resolution or QR rendering yet — Phase 4 and Phase 8 respectively). Video is
 * not handled — nothing in Phase 2's UI can add one (designer.md Phase 9).
 *
 * Phase 4: Image elements now resolve to a real fabric.FabricImage when `assetId` is set and the
 * caller's `resolveAssetUrl` can find it; otherwise (no assetId, asset not yet loaded/found, or
 * the image fails to decode) they fall back to the same placeholder box Phase 2 used. Video stays
 * a placeholder-free hard error — still nothing in the UI can create one (designer.md Phase 9).
 *
 * Phase 8: QR elements resolve to a real generated code (falling back to the placeholder box only
 * when there's no value to encode). Text elements paint with a transparent fill — the visible
 * glyphs are a DOM overlay synced by FabricCanvasAdapter, not drawn by Fabric at all — see that
 * file's Phase 8 comments for why (no real bidi/RTL shaping in Fabric's Textbox).
 *
 * Phase 9: Video elements are the same hybrid idea as text — a transparent hit-box here, real
 * playback in a DOM `<video>` overlay (FabricCanvasAdapter). Scene background color also moved
 * out of Fabric entirely this phase (was `canvas.backgroundColor`, now a DOM div in
 * CanvasViewport, rendered *below* the video overlay layer) — an opaque Fabric-painted background
 * would otherwise sit on top of a video positioned behind the canvas and hide it completely. See
 * FabricCanvasAdapter's Phase 9 comments for the full stacking model.
 */
import { Circle, Ellipse, FabricImage, FabricText, filters, FixedLayout, Group, LayoutManager, Line, Rect, Textbox, Triangle, type FabricObject } from 'fabric';
import { applyElementPosition } from './geometryContract';
import QRCode from 'qrcode';
import type { DesignElement, ImageElement, QrElement, VideoElement } from '@lumina/design-schema';
import { fontStack } from '@lumina/types';
import type { DesignerFabricObject } from './FabricEventBridge';
import { waitForFont } from '../lib/fontReady';

export type ResolveAssetUrl = (assetId: string) => string | undefined;

const PLACEHOLDER_FILL = '#374151';
const PLACEHOLDER_STROKE = '#6b7280';

// Fabric merges constructor options directly over its own per-class defaults (Object.assign-
// style) — a key that's *present* with value `undefined` overwrites a real default (e.g.
// strokeWidth's default of 1) with `undefined`, which then breaks that object's internal render
// cache silently (produces a NaN-sized cache canvas — no error, the shape just never paints,
// while every inspectable property still looks correct). Optional DesignElement fields must be
// omitted entirely, never passed through as explicit `undefined`.
function omitUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

// Every wrapper Group below (placeholderGroup/createImageObject/createQrObject) is sized to the
// element's own width/height by construction and must stay that size no matter how its child is
// transformed. Fabric's default Group layout strategy (FitContentLayout) ignores that intent: it
// unconditionally recomputes the group's width/height/position from the children's *unclipped*
// bounding box on every layout pass (construction, and any future add/remove), so a `cover`-fit
// image — deliberately scaled larger than the box and cropped back down via clipPath, which
// FitContentLayout's bounds calculation doesn't know about — silently overrides the width/height/
// left/top passed into the constructor, leaving the visible (clipped) region shifted into a
// corner of the nominal box. A LayoutManager built on FixedLayout instead keeps exactly the size
// passed in and never re-derives it from children.
function fixedSizeLayoutManager(): LayoutManager {
  return new LayoutManager(new FixedLayout());
}

function placeholderGroup(width: number, height: number, label: string, fill: string, textColor: string): Group {
  const box = new Rect({
    left: 0,
    top: 0,
    width,
    height,
    fill,
    stroke: PLACEHOLDER_STROKE,
    strokeWidth: 1,
    strokeDashArray: [6, 4],
  });
  const text = new FabricText(label, {
    fontSize: Math.max(12, Math.min(width, height) * 0.12),
    fill: textColor,
    originX: 'center',
    originY: 'center',
    left: width / 2,
    top: height / 2,
  });
  return new Group([box, text], { width, height, subTargetCheck: false, interactive: false, layoutManager: fixedSizeLayoutManager() });
}

function createShapeObject(element: Extract<DesignElement, { type: 'shape' }>): FabricObject {
  // strokeWidth is set explicitly (never omitted) so Fabric's own class default (1) can't inflate
  // getScaledWidth/Height() beyond the declared box for a shape with no configured stroke — the
  // selection/rotation geometry must match the declared content box exactly (geometryContract.ts).
  const common = { left: 0, top: 0, strokeWidth: element.strokeWidth ?? 0,
    ...omitUndefined({ fill: element.fill, stroke: element.stroke }) };
  switch (element.shape) {
    case 'rectangle':
      return new Rect({ ...common, width: element.width, height: element.height });
    case 'rounded-rectangle':
      return new Rect({
        ...common,
        width: element.width,
        height: element.height,
        rx: element.radius ?? 12,
        ry: element.radius ?? 12,
      });
    case 'circle':
      return new Circle({ ...common, radius: Math.min(element.width, element.height) / 2 });
    case 'ellipse':
      return new Ellipse({ ...common, rx: element.width / 2, ry: element.height / 2 });
    case 'triangle':
      return new Triangle({ ...common, width: element.width, height: element.height });
    case 'line':
      return new Line([0, 0, element.width, element.height], {
        left: 0,
        top: 0,
        stroke: element.stroke ?? element.fill ?? '#ffffff',
        strokeWidth: element.strokeWidth ?? 2,
      });
  }
}

// Best-effort editor-canvas preview of a subset of ThemeImageAdjustments (brightness/contrast/
// saturation/hue) using fabric's native filter classes, which don't share CSS filter()'s scale or
// math. This is deliberately approximate: the canonical, exact rendering is
// buildImageFilterCss/needsSvgImageFilter (@lumina/types), which the Player will use once it
// renders images as real `<img>` elements per designer.md §23.2 — vibrance/temperature/tint/
// exposure/duotone have no native fabric.filters equivalent and are skipped here rather than
// approximated further. The persisted DesignElement always keeps the exact values regardless.
export function buildPreviewFilters(adjustments: ImageElement['adjustments']): filters.BaseFilter<string>[] {
  if (!adjustments) return [];
  const result: filters.BaseFilter<string>[] = [];
  if (adjustments.brightness) result.push(new filters.Brightness({ brightness: adjustments.brightness / 100 }));
  if (adjustments.contrast) result.push(new filters.Contrast({ contrast: adjustments.contrast / 100 }));
  if (adjustments.saturation) result.push(new filters.Saturation({ saturation: adjustments.saturation / 100 }));
  if (adjustments.hue) result.push(new filters.HueRotation({ rotation: adjustments.hue / 180 }));
  return result;
}

// "contain"/"cover"/"fill" scale for the natural image size into the element's box, then applies
// cropZoom/cropOffsetX/cropOffsetY (designer.md §9 amendment — same flat MediaCrop shape
// CropEditor.tsx already produces) as an additional scale + percentage-of-box pan on top, mirroring
// how @lumina/types' mediaCropStyle composes `object-fit: cover` with a CSS translate/scale.
//
// Returns the crop pan in box-pixel units so the caller can build the *group's* clipPath from it.
// The image itself is intentionally left unclipped here — see buildImageClipPath's comment for why
// clipping `img` directly is wrong once it's wrapped in createImageObject's fixed-size Group.
export function positionImageInBox(img: FabricImage, element: ImageElement): { offsetX: number; offsetY: number } {
  const naturalW = img.width || element.width;
  const naturalH = img.height || element.height;
  const { width, height, fit, cropZoom, cropOffsetX, cropOffsetY } = element;

  const scale =
    fit === 'fill'
      ? 1 // handled via non-uniform scaleX/scaleY below
      : fit === 'contain'
        ? Math.min(width / naturalW, height / naturalH)
        : Math.max(width / naturalW, height / naturalH); // cover

  if (fit === 'fill') {
    img.set({ scaleX: width / naturalW, scaleY: height / naturalH });
  } else {
    const zoom = cropZoom ?? 1;
    img.set({ scaleX: scale * zoom, scaleY: scale * zoom });
  }

  const offsetX = fit === 'fill' ? 0 : ((cropOffsetX ?? 0) / 100) * width;
  const offsetY = fit === 'fill' ? 0 : ((cropOffsetY ?? 0) / 100) * height;

  img.set({
    originX: 'center',
    originY: 'center',
    left: width / 2 + offsetX,
    top: height / 2 + offsetY,
  });

  return { offsetX, offsetY };
}

// A clipPath assigned directly to `img` is drawn in *img's own* rendering context, which by the
// time `_drawClipPath` runs has already been scaled by img.scaleX/scaleY (Fabric applies an
// object's full local matrix before painting its clip). A Rect sized/positioned in box-pixel units
// (e.g. `width`/`height`/`width/2`) therefore gets silently multiplied by the image's cover/contain
// scale too — for a photo scaled down to ~30% to fit its box, that shrinks and mis-centers the clip
// window into a small corner of the box, which is exactly the "only ~25% of the image visible, rest
// blank" bug. Attaching the clipPath to the *Group* instead avoids this: the group is never scaled
// (only positioned), so a Rect in plain box-pixel units clips correctly regardless of how much the
// inner image had to be scaled to satisfy contain/cover/fill.
export function buildImageClipPath(element: ImageElement, offsetX: number, offsetY: number): Rect {
  return new Rect({
    width: element.width,
    height: element.height,
    rx: element.borderRadius ?? 0,
    ry: element.borderRadius ?? 0,
    originX: 'center',
    originY: 'center',
    left: offsetX,
    top: offsetY,
  });
}

// designer_modernization_plan.md M5 — reapplies an image element's *style* fields (fit/crop/flip/
// adjustments/borderRadius) onto an already-installed Group in place, using the exact same math
// createImageObject ran at construction time. Called from FabricCanvasAdapter's live-preview path
// (updateElement) and its syncScene commit-settle path, so the two can never visually disagree,
// and so a crop/fit/adjustment-only edit never has to destroy and recreate the Fabric object (the
// M5 root cause — see FabricCanvasAdapter's narrowed image `contentKey`). Assumes `group` was
// built by createImageObject (i.e. `contentObject` is tagged and is a FabricImage) — never called
// for a placeholder box, which has no such tag.
export function applyImageStylePatch(group: Group, element: ImageElement): void {
  const img = (group as DesignerFabricObject).contentObject as FabricImage | undefined;
  if (!img) return;
  img.flipX = Boolean(element.flipX);
  img.flipY = Boolean(element.flipY);
  const { offsetX, offsetY } = positionImageInBox(img, element);
  img.filters = buildPreviewFilters(element.adjustments);
  img.applyFilters();
  group.clipPath = buildImageClipPath(element, offsetX, offsetY);
  img.setCoords();
  group.setCoords();
}

async function createImageObject(element: ImageElement, resolveAssetUrl: ResolveAssetUrl, signal?: AbortSignal): Promise<FabricObject> {
  const url = element.assetId ? resolveAssetUrl(element.assetId) : undefined;
  if (!url) return placeholderGroup(element.width, element.height, 'Image', PLACEHOLDER_FILL, '#9ca3af');

  let img: FabricImage;
  try {
    img = await FabricImage.fromURL(url, { crossOrigin: 'anonymous', signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    return placeholderGroup(element.width, element.height, 'Image', PLACEHOLDER_FILL, '#9ca3af');
  }

  const { offsetX, offsetY } = positionImageInBox(img, element);
  img.filters = buildPreviewFilters(element.adjustments);
  img.applyFilters();
  if (element.flipX) img.flipX = true;
  if (element.flipY) img.flipY = true;

  // Wrapped in a Group sized exactly to the element's box (like placeholderGroup) so selection/
  // transform handles reflect the element's own width/height regardless of the photo's aspect
  // ratio or the cover/contain scale applied above. Must use a fixed-size layout manager — see
  // fixedSizeLayoutManager's comment for why the default one breaks this.
  const group = new Group([img], {
    strokeWidth: 0,
    left: 0,
    top: 0,
    width: element.width,
    height: element.height,
    subTargetCheck: false,
    layoutManager: fixedSizeLayoutManager(),
  });
  // See buildImageClipPath's comment — the crop/cover window is a Group-level clipPath, not an
  // img-level one, so it isn't affected by the image's own contain/cover scale.
  group.clipPath = buildImageClipPath(element, offsetX, offsetY);
  (group as DesignerFabricObject).contentObject = img;
  return group;
}

// designer.md §17.1/Phase 8 — `element.value` here is already resolved (CanvasViewport applies
// `dynamicBindings` before calling into this factory at all, per §4.1 keeping variable
// resolution out of the Fabric layer entirely — this function never sees a `{{token}}`, only a
// real string or nothing). Renders a real scannable code via the same `qrcode` package
// apps/player's QrCodeWidget already uses; falls back to the placeholder box when there's
// nothing to encode yet.
async function createQrObject(element: QrElement): Promise<FabricObject> {
  const value = element.value?.trim();
  if (!value) return placeholderGroup(element.width, element.height, 'QR', element.backgroundColor, element.foregroundColor);

  let dataUrl: string;
  try {
    dataUrl = await QRCode.toDataURL(value, {
      margin: 1,
      color: { dark: element.foregroundColor, light: element.backgroundColor },
      errorCorrectionLevel: element.errorCorrection,
    });
  } catch {
    return placeholderGroup(element.width, element.height, 'QR', element.backgroundColor, element.foregroundColor);
  }

  const img = await FabricImage.fromURL(dataUrl);
  img.set({ scaleX: element.width / (img.width || element.width), scaleY: element.height / (img.height || element.height) });
  // Same wrapping convention as createImageObject — selection/transform handles reflect the
  // element's own box regardless of the generated code's pixel dimensions.
  return new Group([img], {
    left: 0,
    top: 0,
    width: element.width,
    height: element.height,
    subTargetCheck: false,
    layoutManager: fixedSizeLayoutManager(),
  });
}

// designer.md Phase 9 — video has no fabric.js-native playback, so (like text, Phase 8) this is
// a hybrid: Fabric owns only a hit-box for selection/transform here; the actual visible frame is
// a synced DOM `<video>` overlay (FabricCanvasAdapter), which is why this is fully transparent
// rather than drawing anything — unlike Image/QR, there's no "generate a static picture" step.
function createVideoObject(element: VideoElement): FabricObject {
  if (!element.assetId) return placeholderGroup(element.width, element.height, 'Video', PLACEHOLDER_FILL, '#9ca3af');
  return new Rect({ left: 0, top: 0, width: element.width, height: element.height, strokeWidth: 0, fill: 'transparent' });
}

export async function createFabricObject(element: DesignElement, resolveAssetUrl: ResolveAssetUrl, signal?: AbortSignal): Promise<FabricObject> {
  let obj: FabricObject;

  switch (element.type) {
    case 'text':
      obj = new Textbox(
        element.text,
        omitUndefined({
          width: element.width,
          // `fontFamily` stores a @lumina/types FONT_LIBRARY id (see FontPicker.tsx) — resolve
          // to its actual CSS stack, self-hosted via @fontsource so it renders offline on a
          // kiosk display, same as every other font-consuming surface in this app.
          fontFamily: fontStack(element.fontFamily),
          fontSize: element.fontSize,
          fontWeight: element.fontWeight,
          fontStyle: element.fontStyle,
          // designer.md Phase 8 amendment — Fabric's Textbox has no real bidi/RTL shaping, so it
          // never paints visible glyphs at all: fill is forced transparent and this object exists
          // on canvas purely for hit-testing/selection/transform handles (and Phase 7's animation
          // tweens). The actual visible text is a synced DOM overlay (FabricCanvasAdapter),
          // rendered with native browser text layout — correct bidi for free, nothing hand-built.
          fill: 'transparent',
          editable: false, // A native textarea handles editing with browser Arabic/bidi layout.
          // Fabric's own class default (1) would otherwise inflate getCoords()/getScaledWidth()
          // by a phantom pixel even though nothing is ever stroked here (see geometryContract.ts,
          // which reads corners for selection/commit geometry) — same fix as the M3 shape proxy.
          strokeWidth: 0,
          textAlign: element.textAlign,
          lineHeight: element.lineHeight,
          charSpacing: element.charSpacing,
        }),
      );
      // designer_modernization_plan.md M5 — wait for the real webfont to be usable before Fabric
      // measures this Textbox's wrap width/height, then re-measure. Bounded/best-effort (see
      // fontReady.ts) — never blocks the object from installing if the font is slow or missing.
      await waitForFont(fontStack(element.fontFamily));
      (obj as Textbox).initDimensions();
      break;
    case 'image':
      obj = await createImageObject(element, resolveAssetUrl, signal);
      break;
    case 'shape':
      obj = createShapeObject(element);
      break;
    case 'qr':
      obj = await createQrObject(element);
      break;
    case 'video':
      obj = createVideoObject(element);
      break;
  }

  obj.set({
    originX: 'left',
    originY: 'top',
    angle: element.rotation,
    opacity: element.opacity,
    visible: element.visible,
  });
  // Position last: this reads the angle just set above to place the rotated box correctly (see
  // geometryContract.ts) — setting `left`/`top` directly here would only be correct at rotation 0.
  applyElementPosition(obj, element);

  // designer.md §6 amendment — capability flags replace a single `locked` boolean. No separate
  // "rotatable" flag exists in the model; rotation is grouped with resize (both are "transform"
  // controls a Template author would lock together in practice).
  obj.set({
    selectable: element.selectable,
    evented: element.selectable,
    lockMovementX: !element.movable,
    lockMovementY: !element.movable,
    lockScalingX: !element.resizable,
    lockScalingY: !element.resizable,
    lockRotation: !element.resizable,
    // DesignElement has no skewX/skewY (or flip) fields for any type (designer_modernization_plan
    // M3's "define allowed mirroring/skew behavior" — the answer here is: none yet). Fabric's
    // default side/middle controls can switch from scale to skew on an Alt-drag; without this, a
    // skewed object renders correctly until the next recreate (undo, reload, scene switch), then
    // silently loses the skew because there's nowhere to persist it. Lock it out at the source
    // instead of letting the editor offer an interaction whose result never survives a reload.
    lockSkewingX: true,
    lockSkewingY: true,
  });

  (obj as DesignerFabricObject).elementId = element.id;
  return obj;
}
