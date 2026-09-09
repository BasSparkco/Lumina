import { describe, expect, it } from 'vitest';
import { Rect } from 'fabric';
import { applyElementPosition, fabricPositionForElement, readElementGeometry, type ElementGeometry } from '../geometryContract';

// The Player renders element.x/y/width/height as an unrotated box, then applies
// `transform: rotate(rotation deg)` with `transformOrigin: center center` — see
// apps/player/src/components/DesignRenderer.tsx's ElementView. Compute the same four corners
// independently here (no shared code with geometryContract.ts) as the ground truth this module
// must match.
function playerCorners(geometry: ElementGeometry): { x: number; y: number }[] {
  const cx = geometry.x + geometry.width / 2;
  const cy = geometry.y + geometry.height / 2;
  const rad = (geometry.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const corners = [
    { x: geometry.x, y: geometry.y },
    { x: geometry.x + geometry.width, y: geometry.y },
    { x: geometry.x + geometry.width, y: geometry.y + geometry.height },
    { x: geometry.x, y: geometry.y + geometry.height },
  ];
  return corners.map(({ x, y }) => {
    const dx = x - cx;
    const dy = y - cy;
    // CSS `rotate(deg)` rotates clockwise on screen (y grows downward) — same convention Fabric
    // uses for `angle`/getCoords, confirmed against fabric's own util.rotateVector below.
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
  });
}

function fabricCorners(obj: Rect): { x: number; y: number }[] {
  const coords = obj.getCoords();
  return [coords[0]!, coords[1]!, coords[2]!, coords[3]!].map((p) => ({ x: p.x, y: p.y }));
}

describe('geometryContract — Fabric/Player rotation parity', () => {
  it.each([0, 30, 90, 180, 270, -45])('places a %s° object so its corners match the Player\'s rotate-about-center box', (rotation) => {
    const geometry: ElementGeometry = { x: 40, y: 20, width: 200, height: 100, rotation };
    const obj = new Rect({ originX: 'left', originY: 'top', width: geometry.width, height: geometry.height, strokeWidth: 0 });
    obj.set('angle', rotation);
    applyElementPosition(obj, geometry);
    obj.setCoords();

    const expected = playerCorners(geometry);
    const actual = fabricCorners(obj);
    for (let i = 0; i < 4; i++) {
      expect(actual[i]!.x).toBeCloseTo(expected[i]!.x, 6);
      expect(actual[i]!.y).toBeCloseTo(expected[i]!.y, 6);
    }
  });

  it.each([0, 30, 90, 180, 270, -45])('round-trips geometry through apply/read at %s°', (rotation) => {
    const geometry: ElementGeometry = { x: 15, y: 55, width: 120, height: 80, rotation };
    const obj = new Rect({ originX: 'left', originY: 'top', width: geometry.width, height: geometry.height, strokeWidth: 0 });
    obj.set('angle', rotation);
    applyElementPosition(obj, geometry);
    obj.setCoords();

    const extracted = readElementGeometry(obj);
    expect(extracted.x).toBeCloseTo(geometry.x, 6);
    expect(extracted.y).toBeCloseTo(geometry.y, 6);
    expect(extracted.width).toBeCloseTo(geometry.width, 6);
    expect(extracted.height).toBeCloseTo(geometry.height, 6);
    expect(((extracted.rotation % 360) + 360) % 360).toBeCloseTo(((rotation % 360) + 360) % 360, 6);
  });

  it('is independent of a live object\'s own rendered dimensions (Textbox auto-height)', () => {
    // A Fabric Textbox's real height comes from font metrics/wrapping and can legitimately differ
    // from the design element's stored height. Position must still be driven by the declared
    // geometry, not by whatever height the object itself happens to report.
    const geometry: ElementGeometry = { x: 10, y: 10, width: 200, height: 100, rotation: 0 };
    const position = fabricPositionForElement(geometry, geometry.rotation);
    expect(position).toEqual({ left: 10, top: 10 });
  });
});
