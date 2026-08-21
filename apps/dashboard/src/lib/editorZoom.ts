// Canvas zoom/position clamping shared by the layout and theme editors — was defined identically
// (byte-for-byte) in both LayoutsSection.tsx and ThemesSection.tsx.

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 3;
export const ZOOM_STEP = 1.25;

export const clampPct = (v: number) => Math.min(100, Math.max(0, Math.round(v * 10) / 10));
export const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
