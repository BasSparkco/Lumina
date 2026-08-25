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
 */
import { Circle, Ellipse, FabricImage, FabricText, filters, Group, Line, Rect, Textbox, Triangle, type Canvas, type FabricObject } from 'fabric';
import type { DesignElement, DesignScene, ImageElement } from '@lumina/design-schema';
import { fontStack } from '@lumina/types';
import type { DesignerFabricObject } from './FabricEventBridge';

export type ResolveAssetUrl = (assetId: string) => string | undefined;

export function applySceneBackground(canvas: Canvas, background: DesignScene['background']): void {
  if (background.type === 'color') {
    canvas.backgroundColor = background.color;
    return;
  }
  // Image/video scene backgrounds need an asset-backed fabric object — Phase 2/Phase 9 work
  // (asset resolution isn't wired up yet). Fall back to the canvas's default background for now.
}

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
  return new Group([box, text], { width, height, subTargetCheck: false, interactive: false });
}

function createShapeObject(element: Extract<DesignElement, { type: 'shape' }>): FabricObject {
  const common = omitUndefined({ left: 0, top: 0, fill: element.fill, stroke: element.stroke, strokeWidth: element.strokeWidth });
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
function buildPreviewFilters(adjustments: ImageElement['adjustments']): filters.BaseFilter<string>[] {
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
function positionImageInBox(img: FabricImage, element: ImageElement): void {
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

  img.clipPath = new Rect({
    width,
    height,
    rx: element.borderRadius ?? 0,
    ry: element.borderRadius ?? 0,
    originX: 'center',
    originY: 'center',
    left: width / 2 + offsetX,
    top: height / 2 + offsetY,
  });
}

async function createImageObject(element: ImageElement, resolveAssetUrl: ResolveAssetUrl): Promise<FabricObject> {
  const url = element.assetId ? resolveAssetUrl(element.assetId) : undefined;
  if (!url) return placeholderGroup(element.width, element.height, 'Image', PLACEHOLDER_FILL, '#9ca3af');

  let img: FabricImage;
  try {
    img = await FabricImage.fromURL(url, { crossOrigin: 'anonymous' });
  } catch {
    return placeholderGroup(element.width, element.height, 'Image', PLACEHOLDER_FILL, '#9ca3af');
  }

  positionImageInBox(img, element);
  img.filters = buildPreviewFilters(element.adjustments);
  img.applyFilters();
  if (element.flipX) img.flipX = true;
  if (element.flipY) img.flipY = true;

  // Wrapped in a Group sized exactly to the element's box (like placeholderGroup) so selection/
  // transform handles reflect the element's own width/height regardless of the photo's aspect
  // ratio or the cover/contain scale applied above.
  return new Group([img], { left: 0, top: 0, width: element.width, height: element.height, subTargetCheck: false });
}

export async function createFabricObject(element: DesignElement, resolveAssetUrl: ResolveAssetUrl): Promise<FabricObject> {
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
          fill: element.fill,
          textAlign: element.textAlign,
          lineHeight: element.lineHeight,
          charSpacing: element.charSpacing,
          // RTL glyph shaping/bidi layout isn't attempted here — designer.md Phase 8 follow-up.
          // `direction` is still faithfully persisted on the DesignElement either way.
        }),
      );
      break;
    case 'image':
      obj = await createImageObject(element, resolveAssetUrl);
      break;
    case 'shape':
      obj = createShapeObject(element);
      break;
    case 'qr':
      obj = placeholderGroup(element.width, element.height, 'QR', element.backgroundColor, element.foregroundColor);
      break;
    case 'video':
      throw new Error('Video elements are not supported until designer.md Phase 9');
  }

  obj.set({
    originX: 'left',
    originY: 'top',
    left: element.x,
    top: element.y,
    angle: element.rotation,
    opacity: element.opacity,
    visible: element.visible,
  });

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
  });

  (obj as DesignerFabricObject).elementId = element.id;
  return obj;
}
