export type MediaBounds = { x: number; y: number; width: number; height: number };

function validDimensions(width: number | null, height: number | null): boolean {
  return Number.isFinite(width) && Number.isFinite(height) && (width ?? 0) > 0 && (height ?? 0) > 0;
}

export function fitMediaBox(width: number, height: number, bounds: MediaBounds): MediaBounds {
  if (!validDimensions(width, height) || !validDimensions(bounds.width, bounds.height)) throw new Error('Invalid media dimensions');
  const scale = Math.min(1, bounds.width * 0.8 / width, bounds.height * 0.8 / height);
  const w = width * scale;
  const h = height * scale;
  return { x: bounds.x + (bounds.width - w) / 2, y: bounds.y + (bounds.height - h) / 2, width: w, height: h };
}

