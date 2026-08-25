// Shared layer-ordering logic for the layouts (zones) and themes (elements) editors. Layer
// z-indexes are kept on multiples of LAYER_STEP so a manually-typed value (e.g. 25) can still be
// slotted between two existing layers (20 and 30) without renumbering everything else.
export const LAYER_STEP = 10;

interface Layerable {
  zIndex: number;
}

// z-index for a newly created or duplicated item — always lands on top.
export function nextLayerZIndex(items: Layerable[]): number {
  if (items.length === 0) return LAYER_STEP;
  return Math.max(...items.map((i) => i.zIndex)) + LAYER_STEP;
}

export function bringToFront(items: Layerable[], currentZIndex: number): number {
  const maxZ = Math.max(currentZIndex, ...items.map((i) => i.zIndex));
  return maxZ + LAYER_STEP;
}

export function sendToBack(items: Layerable[], currentZIndex: number): number {
  const minZ = Math.min(currentZIndex, ...items.map((i) => i.zIndex));
  return minZ - LAYER_STEP;
}

// Front-to-back order (highest zIndex first) — how the Layers panel lists items, top row = front.
export function sortByZDesc<T extends Layerable>(items: T[]): T[] {
  return [...items].sort((a, b) => b.zIndex - a.zIndex);
}

// Reassigns zIndex for a list already ordered front-to-back (as dragged in the Layers panel),
// spacing values by LAYER_STEP: topmost (front) item gets the highest multiple.
export function reindexLayers<T>(
  orderedFrontToBack: T[],
  setZ: (item: T, zIndex: number) => T,
): T[] {
  const n = orderedFrontToBack.length;
  return orderedFrontToBack.map((item, idx) => setZ(item, (n - idx) * LAYER_STEP));
}
