/**
 * The Fabric/Player coordinate boundary (designer_modernization_plan.md M3).
 *
 * Design elements store x/y as the *unrotated* content box's top-left, with rotation applied
 * around that box's own center — this is what apps/player's DesignRenderer.tsx does: place a div
 * at x,y unrotated, sized width×height, then `transform: rotate()` with `transformOrigin: center
 * center`. Fabric objects here use `originX/originY: 'left'/'top'`, so Fabric's own `left/top` is
 * the position of that same local corner AFTER Fabric's rotation is applied around the object's
 * center (Fabric's default interactive-rotation behavior keeps the visual center fixed while
 * spinning the object around it). The two coordinates coincide only at rotation 0 — copying
 * `obj.left`/`obj.top` directly into element x/y (or back) silently shifts rotated objects.
 *
 * Always cross this boundary through the object's center point (`getCenterPoint` /
 * `setPositionByOrigin`), never by reading or writing `left`/`top` directly, whenever an
 * element's rotation may be non-zero.
 */
import { Point, util, type FabricObject } from 'fabric';

export interface ElementGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

// Fabric's left/top (origin left/top) equivalent for a box whose *unrotated* content occupies
// geometry.x/y/width/height, rotated in place around that box's own center — deliberately a pure
// function of the declared geometry, never of a live object's own rendered dimensions. A Fabric
// Textbox's actual height is derived from font metrics/wrapping and can transiently differ from
// the design element's stored height (e.g. right after creation, before the next commit); using
// `obj`'s live size here would silently shift such objects away from their stored x/y.
export function fabricPositionForElement(
  geometry: Pick<ElementGeometry, 'x' | 'y' | 'width' | 'height'>,
  rotationDegrees: number,
): { left: number; top: number } {
  if (rotationDegrees % 360 === 0) return { left: geometry.x, top: geometry.y };
  const cx = geometry.x + geometry.width / 2;
  const cy = geometry.y + geometry.height / 2;
  const cornerFromCenter = new Point(geometry.x - cx, geometry.y - cy);
  const rotated = util.rotateVector(cornerFromCenter, util.degreesToRadians(rotationDegrees));
  return { left: cx + rotated.x, top: cy + rotated.y };
}

// Positions `obj` so its unrotated content box has top-left (geometry.x, geometry.y) and size
// geometry.width × geometry.height, rotated in place around that box's center. Uses the object's
// *current* angle — set that first if it is also changing.
export function applyElementPosition(
  obj: FabricObject,
  geometry: Pick<ElementGeometry, 'x' | 'y' | 'width' | 'height'>,
): void {
  obj.set(fabricPositionForElement(geometry, obj.angle ?? 0));
}

// Reads `obj`'s current geometry back into the element x/y/rotation contract described above.
// Uses absolute corner points (`getCoords()`), not `getCenterPoint()`/`obj.angle` — those read
// `obj`'s own left/top/angle, which are *local to its parent* when `obj` is a member of an active
// multi-select (ActiveSelection): correct for a standalone object, silently wrong for a grouped
// one. `getCoords()` already composes through any parent group's transform (and, independently
// verified, is unaffected by canvas zoom — it's canvas/model space, not screen space), so this one
// implementation is correct for both.
export function readElementGeometry(obj: FabricObject): ElementGeometry {
  const coords = obj.getCoords();
  const [tl, tr, br, bl] = [coords[0]!, coords[1]!, coords[2]!, coords[3]!];
  const width = Math.hypot(tr.x - tl.x, tr.y - tl.y);
  const height = Math.hypot(bl.x - tl.x, bl.y - tl.y);
  const rotation = ((Math.atan2(tr.y - tl.y, tr.x - tl.x) * 180) / Math.PI % 360 + 360) % 360;
  const cx = (tl.x + tr.x + br.x + bl.x) / 4;
  const cy = (tl.y + tr.y + br.y + bl.y) / 4;
  return { x: cx - width / 2, y: cy - height / 2, width, height, rotation };
}

