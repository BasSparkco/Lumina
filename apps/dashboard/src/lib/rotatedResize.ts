import type { CSSProperties } from 'react';

export type ResizeHandle = 'top' | 'bottom' | 'left' | 'right' | 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';

export const RESIZE_HANDLES: ResizeHandle[] = ['topLeft', 'top', 'topRight', 'left', 'right', 'bottomLeft', 'bottom', 'bottomRight'];

// ax/ay say which side of the (unrotated) box this handle sits on: -1 = start edge, 1 = end
// edge, 0 = the edge is centered on that axis (an edge-midpoint handle, only the other axis
// resizes). The opposite handle (-ax, -ay) is always this one's fixed anchor during a drag.
export const RESIZE_HANDLE_AXIS: Record<ResizeHandle, { ax: -1 | 0 | 1; ay: -1 | 0 | 1; cursor: string }> = {
  topLeft: { ax: -1, ay: -1, cursor: 'nwse-resize' },
  top: { ax: 0, ay: -1, cursor: 'ns-resize' },
  topRight: { ax: 1, ay: -1, cursor: 'nesw-resize' },
  left: { ax: -1, ay: 0, cursor: 'ew-resize' },
  right: { ax: 1, ay: 0, cursor: 'ew-resize' },
  bottomLeft: { ax: -1, ay: 1, cursor: 'nesw-resize' },
  bottom: { ax: 0, ay: 1, cursor: 'ns-resize' },
  bottomRight: { ax: 1, ay: 1, cursor: 'nwse-resize' },
};

export function resizeHandleStyle(handle: ResizeHandle): CSSProperties {
  const { ax, ay } = RESIZE_HANDLE_AXIS[handle];
  const style: CSSProperties = { position: 'absolute' };
  if (ax === -1) style.left = -5;
  else if (ax === 1) style.right = -5;
  else { style.left = '50%'; style.transform = 'translateX(-50%)'; }
  if (ay === -1) style.top = -5;
  else if (ay === 1) style.bottom = -5;
  else { style.top = '50%'; style.transform = 'translateY(-50%)'; }
  return style;
}

export type Box = { left: number; top: number; width: number; height: number };

// A rotated shape's resize handles are rendered inside the same rotated wrapper as the shape
// itself, so they sit at its true visual corners/edges on screen — but the underlying box is
// still just plain x/y/width/height in canvas space (rotation is applied on top, around the
// box's own center). Dragging a handle has to: (1) find the opposite corner/edge, which is what
// stays visually fixed on screen for the whole gesture, and (2) undo the shape's rotation from
// the mouse's on-screen movement before treating it as a width/height change — the same approach
// Figma/PowerPoint use for resizing a rotated shape.
export function rotatedResizeAnchor(box: Box, rotationDeg: number, handle: ResizeHandle): { x: number; y: number } {
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const center = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  const { ax, ay } = RESIZE_HANDLE_AXIS[handle];
  const local = { x: -ax * (box.width / 2), y: -ay * (box.height / 2) };
  return {
    x: center.x + local.x * cos - local.y * sin,
    y: center.y + local.x * sin + local.y * cos,
  };
}

// `anchor` must come from `rotatedResizeAnchor`, captured once when the drag starts — it's a
// fixed canvas-space point for the rest of the gesture. `mouse` is the current mouse position in
// the same canvas-space coordinates.
export function rotatedResizeBox(
  rotationDeg: number,
  handle: ResizeHandle,
  anchor: { x: number; y: number },
  mouse: { x: number; y: number },
  currentSize: { width: number; height: number },
  minSize: number,
): Box {
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const { ax, ay } = RESIZE_HANDLE_AXIS[handle];
  const dWorld = { x: mouse.x - anchor.x, y: mouse.y - anchor.y };
  // Undo the shape's own rotation to get the drag delta in its unrotated local axes.
  const dLocal = { x: dWorld.x * cos + dWorld.y * sin, y: -dWorld.x * sin + dWorld.y * cos };
  const width = ax === 0 ? currentSize.width : Math.max(minSize, Math.abs(dLocal.x));
  const height = ay === 0 ? currentSize.height : Math.max(minSize, Math.abs(dLocal.y));
  // Only the axis actually being resized may move the center — an edge handle's other (locked)
  // axis never shifts, so dragging "right" on a rotated zone can't also nudge it vertically.
  const centerOffsetLocal = { x: ax === 0 ? 0 : dLocal.x / 2, y: ay === 0 ? 0 : dLocal.y / 2 };
  const centerWorld = {
    x: anchor.x + centerOffsetLocal.x * cos - centerOffsetLocal.y * sin,
    y: anchor.y + centerOffsetLocal.x * sin + centerOffsetLocal.y * cos,
  };
  return { left: centerWorld.x - width / 2, top: centerWorld.y - height / 2, width, height };
}
