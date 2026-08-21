// Raster paint engine for the theme editor's brush tool — a real paint-program surface (brush,
// eraser, fill bucket, eyedropper) backed by an offscreen <canvas>, kept separate from
// ThemesSection's own state/JSX so the pixel math and per-brush-type rendering don't get lost
// in that file's much larger element-editing logic. ThemesSection owns *which* ThemeElement
// holds the bitmap and when to commit it to history; this module only ever touches pixels.

import type { ThemeAspectRatio } from '@lumina/types';

export type BrushType = 'brush' | 'calligraphy' | 'marker' | 'crayon' | 'oil';
export const BRUSH_TYPES: BrushType[] = ['brush', 'calligraphy', 'marker', 'crayon', 'oil'];

export type PaintTool = 'brush' | 'eraser' | 'fill';
export const PAINT_TOOLS: PaintTool[] = ['brush', 'eraser', 'fill'];

// Pixel-space point on the paint layer's own bitmap (not canvas percent, not screen px).
export interface RasterPoint {
  x: number;
  y: number;
}

// Fixed working resolution per aspect ratio — high enough to look crisp at typical screen
// sizes without making every theme save carry an oversized base64 PNG.
const RESOLUTIONS: Record<ThemeAspectRatio, { width: number; height: number }> = {
  '16:9': { width: 1600, height: 900 },
  '9:16': { width: 900, height: 1600 },
  '4:3': { width: 1600, height: 1200 },
  '1:1': { width: 1200, height: 1200 },
};

export function paintLayerResolution(aspectRatio: string): { width: number; height: number } {
  return RESOLUTIONS[aspectRatio as ThemeAspectRatio] ?? RESOLUTIONS['16:9'];
}

export function blankRasterDataUrl(width: number, height: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas.toDataURL('image/png');
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('paint layer image failed to load'));
    img.src = src;
  });
}

export interface StrokeOptions {
  type: BrushType;
  color: string;
  size: number; // brush diameter, in raster px
  opacity: number; // 0–1
}

// One incremental segment (previous recorded point → new point) — called on every pointermove
// so a stroke paints live instead of only appearing once the pointer is released. A tap with no
// movement should call this with from === to, which every branch below still renders as a dot
// (round caps/stamps at a zero-length segment still paint).
export function strokeSegment(ctx: CanvasRenderingContext2D, from: RasterPoint, to: RasterPoint, opts: StrokeOptions) {
  const { type, color, size, opacity } = opts;
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  switch (type) {
    case 'brush':
      ctx.globalAlpha = opacity;
      ctx.strokeStyle = color;
      ctx.lineWidth = size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      break;
    case 'marker':
      // Flatter cap, a bit bolder, and never fully opaque — overlapping marker passes darken
      // like the real thing instead of just painting one flat color.
      ctx.globalAlpha = opacity * 0.8;
      ctx.strokeStyle = color;
      ctx.lineWidth = size * 1.15;
      ctx.lineCap = 'square';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      break;
    case 'oil': {
      // A handful of thin, slightly offset parallel passes read as bristles instead of one
      // clean line — offsets are perpendicular to the segment's own direction so they still
      // look right on curves, not just on a horizontal stroke.
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = color;
      for (const o of [-0.35, -0.12, 0.12, 0.35]) {
        ctx.globalAlpha = opacity * 0.35;
        ctx.lineWidth = size * 0.5;
        ctx.beginPath();
        ctx.moveTo(from.x + nx * size * o, from.y + ny * size * o);
        ctx.lineTo(to.x + nx * size * o, to.y + ny * size * o);
        ctx.stroke();
      }
      ctx.globalAlpha = opacity * 0.6;
      ctx.lineWidth = size * 0.85;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      break;
    }
    case 'calligraphy':
      drawCalligraphyRibbon(ctx, from, to, size, color, opacity);
      break;
    case 'crayon':
      stampAlongSegment(from, to, size * 0.22, (p) => drawCrayonStamp(ctx, p, size, color, opacity));
      break;
  }
  ctx.restore();
}

function stampAlongSegment(from: RasterPoint, to: RasterPoint, spacing: number, stamp: (p: RasterPoint) => void) {
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.max(1, Math.round(dist / Math.max(1, spacing)));
  for (let s = 1; s <= steps; s++) {
    stamp({ x: from.x + ((to.x - from.x) * s) / steps, y: from.y + ((to.y - from.y) * s) / steps });
  }
}

// Fixed nib angle regardless of stroke direction — real calligraphy pens work the same way,
// which is exactly what makes a stroke thin in one direction and broad in the perpendicular one.
const CALLIGRAPHY_ANGLE = -45 * (Math.PI / 180);
// A filled ribbon (the nib's rectangular footprint swept along the segment) instead of stamped
// dots — discrete stamps at a fixed rotation leave a jagged fishbone edge wherever the path
// direction doesn't match the nib angle; a swept quad reads as one continuous stroke instead.
function drawCalligraphyRibbon(
  ctx: CanvasRenderingContext2D,
  from: RasterPoint,
  to: RasterPoint,
  size: number,
  color: string,
  opacity: number,
) {
  const halfWidth = size * 0.5;
  const nx = Math.cos(CALLIGRAPHY_ANGLE) * halfWidth;
  const ny = Math.sin(CALLIGRAPHY_ANGLE) * halfWidth;
  ctx.globalAlpha = opacity;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(from.x + nx, from.y + ny);
  ctx.lineTo(to.x + nx, to.y + ny);
  ctx.lineTo(to.x - nx, to.y - ny);
  ctx.lineTo(from.x - nx, from.y - ny);
  ctx.closePath();
  ctx.fill();
  // A round cap at the new endpoint smooths the joint between this segment and the next one
  // (path direction changes between pointermove samples otherwise leave a visible seam), and is
  // what actually renders for a tap with no movement (from === to degenerates the quad above).
  ctx.beginPath();
  ctx.arc(to.x, to.y, halfWidth, 0, Math.PI * 2);
  ctx.fill();
}

function drawCrayonStamp(ctx: CanvasRenderingContext2D, p: RasterPoint, size: number, color: string, opacity: number) {
  ctx.save();
  ctx.fillStyle = color;
  // A handful of small jittered dots per stamp instead of one solid disc — that grain is what
  // reads as "waxy crayon" rather than a plain marker dot.
  for (let i = 0; i < 5; i++) {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.random() * size * 0.45;
    ctx.globalAlpha = opacity * (0.3 + Math.random() * 0.4);
    ctx.beginPath();
    ctx.arc(p.x + Math.cos(angle) * r, p.y + Math.sin(angle) * r, size * (0.12 + Math.random() * 0.1), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// Punches a real transparency hole — true pixel erasing, as opposed to deleting a whole stroke
// element (which is all the old vector-polyline brush could ever do).
export function eraseSegment(ctx: CanvasRenderingContext2D, from: RasterPoint, to: RasterPoint, size: number) {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.globalAlpha = 1;
  ctx.lineWidth = size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.restore();
}

function hexToRgba(hex: string, alpha: number): { r: number; g: number; b: number; a: number } {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const num = parseInt(full, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255, a: Math.round(alpha * 255) };
}

const FILL_TOLERANCE = 32;

// MS-Paint-style flood fill: fills the contiguous region of similar pixels around (startX,
// startY) with `color`/`opacity`, stopping at anything that reads as a different color — in
// practice, the edges of whatever brush strokes were drawn to enclose the area. Operates only on
// the paint layer's own bitmap (not the DOM's other, separately-rendered elements), so a region
// bounded by a SHAPE element rather than a brush stroke won't stop the fill.
export function floodFill(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  startX: number,
  startY: number,
  color: string,
  opacity: number,
) {
  const x0 = Math.floor(startX);
  const y0 = Math.floor(startY);
  if (x0 < 0 || y0 < 0 || x0 >= width || y0 >= height) return;

  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const at = (i: number) => data[i] ?? 0;
  const startI = (y0 * width + x0) * 4;
  const target = { r: at(startI), g: at(startI + 1), b: at(startI + 2), a: at(startI + 3) };
  const fill = hexToRgba(color, opacity);

  // Filling a region that's already (about) this color/opacity would still cost a full scan for
  // no visible effect.
  if (
    Math.abs(target.r - fill.r) < 2 &&
    Math.abs(target.g - fill.g) < 2 &&
    Math.abs(target.b - fill.b) < 2 &&
    Math.abs(target.a - fill.a) < 2
  ) {
    return;
  }

  const matches = (i: number) =>
    Math.abs(at(i) - target.r) <= FILL_TOLERANCE &&
    Math.abs(at(i + 1) - target.g) <= FILL_TOLERANCE &&
    Math.abs(at(i + 2) - target.b) <= FILL_TOLERANCE &&
    Math.abs(at(i + 3) - target.a) <= FILL_TOLERANCE;

  const visited = new Uint8Array(width * height);
  const stack: number[] = [x0, y0];
  const a = fill.a / 255;
  while (stack.length) {
    const y = stack.pop()!;
    const x = stack.pop()!;
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const p = y * width + x;
    if (visited[p]) continue;
    const i = p * 4;
    if (!matches(i)) continue;
    visited[p] = 1;
    // Standard source-over compositing of the fill color onto whatever pixel was already there.
    data[i] = at(i) * (1 - a) + fill.r * a;
    data[i + 1] = at(i + 1) * (1 - a) + fill.g * a;
    data[i + 2] = at(i + 2) * (1 - a) + fill.b * a;
    data[i + 3] = Math.min(255, fill.a + at(i + 3) * (1 - a));
    stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }
  ctx.putImageData(imageData, 0, 0);
}

// The real OS-level eyedropper (Chrome/Edge) — lets the user click literally anywhere on the
// screen, not just this canvas, and returns the exact pixel color under the cursor. Unsupported
// in Safari/Firefox as of this writing; callers should hide/disable the button when this is
// false rather than attempting a same-canvas-only fallback.
export function isEyeDropperSupported(): boolean {
  return typeof window !== 'undefined' && 'EyeDropper' in window;
}

export async function pickColorFromScreen(): Promise<string | null> {
  if (!isEyeDropperSupported()) return null;
  try {
    const EyeDropperCtor = (window as unknown as { EyeDropper: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper;
    const result = await new EyeDropperCtor().open();
    return result.sRGBHex;
  } catch {
    // User pressed Escape / dismissed the picker — not an error worth surfacing.
    return null;
  }
}
