// Figma/Slides-style alignment guides shared by the layout and theme editors: snaps a moving
// zone/element's edges or center onto any other zone/element's (or the canvas's own) edges/center
// once within SNAP_THRESHOLD px, and reports where to draw the guide lines.

export type Box = { left: number; top: number; width: number; height: number };

const SNAP_THRESHOLD = 6;

// Snap a moving edge (or center) to the nearest same-axis edge/center among the given targets.
export function snapDragAxis(pos: number, size: number, targets: number[]): { pos: number; guide: number | null } {
  const candidates = [pos, pos + size / 2, pos + size];
  let bestDiff = SNAP_THRESHOLD;
  let result: { pos: number; guide: number } | null = null;
  for (const target of targets) {
    for (const c of candidates) {
      const diff = Math.abs(c - target);
      if (diff < bestDiff) {
        bestDiff = diff;
        result = { pos: target - (c - pos), guide: target };
      }
    }
  }
  return result ?? { pos, guide: null };
}

export function snapEdge(value: number, targets: number[]): { value: number; guide: number | null } {
  let bestDiff = SNAP_THRESHOLD;
  let best: number | null = null;
  for (const target of targets) {
    const diff = Math.abs(value - target);
    if (diff < bestDiff) { bestDiff = diff; best = target; }
  }
  return best !== null ? { value: best, guide: best } : { value, guide: null };
}

// Alignment targets (px) for a canvas: its own bounds/center plus every other box's edges/center.
export function computeAlignTargets(canvasW: number, canvasH: number, otherBoxes: Box[]): { xs: number[]; ys: number[] } {
  const xs = new Set<number>([0, canvasW / 2, canvasW]);
  const ys = new Set<number>([0, canvasH / 2, canvasH]);
  otherBoxes.forEach(b => {
    xs.add(b.left); xs.add(b.left + b.width / 2); xs.add(b.left + b.width);
    ys.add(b.top); ys.add(b.top + b.height / 2); ys.add(b.top + b.height);
  });
  return { xs: [...xs], ys: [...ys] };
}

export function clampBox(box: Box, canvasW: number, canvasH: number): Box {
  const width = Math.min(box.width, canvasW);
  const height = Math.min(box.height, canvasH);
  return {
    width, height,
    left: Math.min(Math.max(box.left, 0), canvasW - width),
    top: Math.min(Math.max(box.top, 0), canvasH - height),
  };
}

// react-rnd resize resolver: snaps only the edge(s) actually being dragged (per `direction`,
// react-rnd's own handle name like "right"/"bottomRight") onto the alignment targets, then
// clamps to the canvas. Used for the unrotated (rotation === 0) resize case, where react-rnd's
// built-in handles still line up with the visible box.
export function resolveResize(
  direction: string, box: Box, targets: { xs: number[]; ys: number[] }, minPx: number, canvasW: number, canvasH: number,
): { box: Box; guides: { v: number[]; h: number[] } } {
  let { left, top, width, height } = box;
  let right = left + width, bottom = top + height;
  const vGuides: number[] = [];
  const hGuides: number[] = [];

  if (/right/i.test(direction)) {
    const s = snapEdge(right, targets.xs);
    if (s.guide !== null) { right = s.value; vGuides.push(s.guide); }
  }
  if (/left/i.test(direction)) {
    const s = snapEdge(left, targets.xs);
    if (s.guide !== null) { left = s.value; vGuides.push(s.guide); }
  }
  if (/bottom/i.test(direction)) {
    const s = snapEdge(bottom, targets.ys);
    if (s.guide !== null) { bottom = s.value; hGuides.push(s.guide); }
  }
  if (/top/i.test(direction)) {
    const s = snapEdge(top, targets.ys);
    if (s.guide !== null) { top = s.value; hGuides.push(s.guide); }
  }

  width = Math.max(minPx, right - left);
  height = Math.max(minPx, bottom - top);
  return { box: clampBox({ left, top, width, height }, canvasW, canvasH), guides: { v: vGuides, h: hGuides } };
}
