'use client';
import { RotateCw } from 'lucide-react';
import type { RotateHandleStyle } from '@/hooks/useRotateHandleStyle';

// Offset clear of the corner (not just straddling it) so the handle is visually and functionally
// distinct from the rotation-aware resize handles, which sit right at the corner (-5px, see
// resizeHandleStyle in rotatedResize.ts) once the shape is rotated and both sets of handles are
// visible together. Kept modest rather than pushed to the point of fully clearing the resize
// handle's footprint — a bigger offset gets amplified by the shape's own rotation and can swing a
// corner handle surprisingly far for a large, heavily rotated zone. The callers render these
// handles after the resize handles in the DOM so that on any residual pixel overlap, the rotate
// handle — painted last — is the one that actually receives the click, which is what makes this
// safe even without full separation. Rotated so the curved arrows read as flowing around the
// shape rather than four identical copies.
const CORNER_HANDLES = [
  { corner: 'nw', pos: { top: -14, left: -14 }, iconRotate: 270 },
  { corner: 'ne', pos: { top: -14, right: -14 }, iconRotate: 0 },
  { corner: 'se', pos: { bottom: -14, right: -14 }, iconRotate: 90 },
  { corner: 'sw', pos: { bottom: -14, left: -14 }, iconRotate: 180 },
] as const;

/** Renders the rotate grip(s) for a selected zone/element. The wrapping element already carries
 * the live `rotate(...)` transform, so handles positioned here swing around with the shape. */
export function ZoneRotateHandle({
  style,
  color,
  hint,
  onStartRotate,
}: {
  style: RotateHandleStyle;
  color: string;
  hint: string;
  onStartRotate: (e: React.MouseEvent) => void;
}) {
  if (style === 'corners') {
    return (
      <>
        {CORNER_HANDLES.map(({ corner, pos, iconRotate }) => (
          <div
            key={corner}
            className="rotate-handle"
            onMouseDown={onStartRotate}
            title={hint}
            style={{
              position: 'absolute',
              ...pos,
              width: 18,
              height: 18,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'white',
              border: `1.5px solid ${color}`,
              cursor: 'grab',
              boxShadow: '0 1px 3px rgba(0,0,0,0.35)',
              pointerEvents: 'auto',
            }}
          >
            <RotateCw
              className="w-2.5 h-2.5"
              style={{ color, transform: `rotate(${iconRotate}deg)` }}
            />
          </div>
        ))}
      </>
    );
  }

  return (
    <>
      <div
        className="rotate-handle"
        onMouseDown={onStartRotate}
        title={hint}
        style={{
          position: 'absolute',
          top: -22,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: color,
          border: '2px solid white',
          cursor: 'grab',
          boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
          pointerEvents: 'auto',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: -22,
          left: '50%',
          width: 1,
          height: 22,
          background: color,
          transform: 'translateX(-50%)',
          pointerEvents: 'none',
        }}
      />
    </>
  );
}
