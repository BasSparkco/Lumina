// fabric.js equivalents of @lumina/types' CSS-based shapeClipStyle/mediaCropStyle — the player
// renderer and (for now) the Themes editor still render those the same way, but a fabric.Group
// has no `clip-path`/`object-fit` CSS to lean on, so the same shape/crop geometry is rebuilt here
// against fabric's own object model instead.
//
// Every helper below works in a zone/element's own *local group coordinates*: (0,0) is the box's
// own center (how fabric positions a Group's children and its clipPath by default), x grows right
// and y grows down, spanning [-width/2, width/2] x [-height/2, height/2]. Callers building a
// fabric.Group of size (width, height) can pass a child's `left`/`top` (with originX:'left',
// originY:'top') straight from these functions' output.

import { Ellipse, Polygon, Rect, type FabricObject } from 'fabric';
import { shapeOutlineGeometry, type ThemeElementShape } from '@lumina/types';

/** Box top-left-origin (x, y) -> this group's centered local coordinates. */
export function toGroupLocal(x: number, y: number, width: number, height: number): { x: number; y: number } {
  return { x: x - width / 2, y: y - height / 2 };
}

/**
 * Builds a clipPath object for a zone/element's shape, sized to (width, height) and positioned in
 * group-local coordinates — assign it to `group.clipPath`. Returns undefined for 'rectangle' (or
 * no shape), matching shapeClipStyle's no-op case.
 */
export function buildShapeClipPath(
  shape: ThemeElementShape | undefined,
  width: number,
  height: number,
): FabricObject | undefined {
  if (!shape || shape === 'rectangle') return undefined;
  if (shape === 'rounded') {
    return new Rect({
      width,
      height,
      rx: width * 0.12,
      ry: height * 0.12,
      left: -width / 2,
      top: -height / 2,
      originX: 'left',
      originY: 'top',
    });
  }
  const geo = shapeOutlineGeometry(shape);
  if (geo.kind === 'ellipse') {
    return new Ellipse({
      rx: width / 2,
      ry: height / 2,
      left: -width / 2,
      top: -height / 2,
      originX: 'left',
      originY: 'top',
    });
  }
  if (geo.kind === 'polygon') {
    const points = geo.points.split(' ').map((pair) => {
      const [px = 0, py = 0] = pair.split(',').map(Number);
      return { x: (px / 100) * width, y: (py / 100) * height };
    });
    // Polygon points passed to the constructor are absolute (own top-left-origin space); its
    // computed left/top would otherwise sit wherever the point cloud happens to land, so pin them
    // to the same origin used everywhere else here rather than fabric's auto-fit bounding box.
    return new Polygon(points, { left: -width / 2, top: -height / 2, originX: 'left', originY: 'top' });
  }
  return undefined;
}

export type MediaFit = 'fill' | 'contain' | 'cover';

export interface MediaCrop {
  cropZoom?: number | null;
  cropOffsetX?: number | null;
  cropOffsetY?: number | null;
}

/**
 * fabric equivalent of `mediaCropStyle` + a base CSS `object-fit`: computes where to place and how
 * to scale an already-loaded image/video-thumbnail inside a (boxWidth, boxHeight) box, returning
 * group-local left/top (top-left origin) + scaleX/scaleY to apply to the FabricImage. Mirrors the
 * CSS composition exactly — object-fit lays the content out first, then `translate(x%, y%)
 * scale(cropZoom)` (transform-origin: center, i.e. the box's own center) is applied on top.
 */
export function fitMediaInBox(
  boxWidth: number,
  boxHeight: number,
  naturalWidth: number,
  naturalHeight: number,
  fit: MediaFit,
  crop?: MediaCrop,
): { left: number; top: number; scaleX: number; scaleY: number } {
  let scaleX: number;
  let scaleY: number;
  if (fit === 'fill') {
    scaleX = boxWidth / naturalWidth;
    scaleY = boxHeight / naturalHeight;
  } else {
    const scale =
      fit === 'cover'
        ? Math.max(boxWidth / naturalWidth, boxHeight / naturalHeight)
        : Math.min(boxWidth / naturalWidth, boxHeight / naturalHeight);
    scaleX = scale;
    scaleY = scale;
  }
  const renderW = naturalWidth * scaleX;
  const renderH = naturalHeight * scaleY;
  let left = (boxWidth - renderW) / 2;
  let top = (boxHeight - renderH) / 2;

  const cropZoom = crop?.cropZoom;
  if (cropZoom) {
    const s = cropZoom;
    const dx = ((crop?.cropOffsetX ?? 0) / 100) * boxWidth;
    const dy = ((crop?.cropOffsetY ?? 0) / 100) * boxHeight;
    const cx = boxWidth / 2;
    const cy = boxHeight / 2;
    left = cx + s * (left - cx) + dx;
    top = cy + s * (top - cy) + dy;
    scaleX *= s;
    scaleY *= s;
  }

  const local = toGroupLocal(left, top, boxWidth, boxHeight);
  return { left: local.x, top: local.y, scaleX, scaleY };
}
