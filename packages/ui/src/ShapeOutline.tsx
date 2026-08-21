import { shapeOutlineGeometry, type ThemeElementShape } from '@lumina/types';

interface ShapeOutlineProps {
  shape: ThemeElementShape | undefined;
  color: string;
  strokeWidthPx: number | undefined;
  opacity?: number;
}

// Renders `shapeFill: 'outline'` as a stroked ring/silhouette instead of a solid fill — a plain
// CSS `border` on a clip-path'd box only follows the box's rectangular edge, not an arbitrary
// polygon, so arrow/star/pentagon/etc. need a real SVG stroke to look like a clean outline.
// Shared between the player's ThemeRenderer (actual on-screen playback) and the dashboard's
// ThemesSection editor (canvas preview) — was previously copy-pasted identically in both.
export function ShapeOutline({ shape, color, strokeWidthPx, opacity }: ShapeOutlineProps) {
  const geo = shapeOutlineGeometry(shape);
  const sw = strokeWidthPx ?? 4;
  const inset = sw / 2;
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%', display: 'block', opacity }}>
      {geo.kind === 'rect' && (
        <rect x={inset} y={inset} width={100 - sw} height={100 - sw} rx={geo.rx} fill="none" stroke={color} strokeWidth={sw} />
      )}
      {geo.kind === 'ellipse' && (
        <ellipse cx={50} cy={50} rx={50 - inset} ry={50 - inset} fill="none" stroke={color} strokeWidth={sw} />
      )}
      {geo.kind === 'polygon' && (
        <polygon points={geo.points} fill="none" stroke={color} strokeWidth={sw} strokeLinejoin="round" />
      )}
    </svg>
  );
}
