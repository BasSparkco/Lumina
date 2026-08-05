import { useEffect, useState } from 'react';
import { resolveThemeColor, fontStack, shapeClipStyle, shapeOutlineGeometry, brushPolylinePoints, mediaCropStyle } from '@lumina/types';
import type { HydratedTheme, HydratedThemeElement, PlayerState } from '../lib/api';
import ZonePlayer from './ZonePlayer';
import LiveWidget from './LiveWidget';

// style.fontFamily is either the 'heading'/'body' sentinel (defer to the theme's own
// typography) or a font id from the shared FONT_LIBRARY chosen directly on this element.
function resolveFontFamily(styleFontFamily: string | undefined, typography: HydratedTheme['typography']): string {
  if (styleFontFamily === 'heading') return fontStack(typography.headingFont);
  if (styleFontFamily === 'body') return fontStack(typography.bodyFont);
  return fontStack(styleFontFamily ?? typography.bodyFont);
}

interface Props {
  theme: HydratedTheme;
  state: PlayerState;
  onAssetChange: (id: string) => void;
}

export default function ThemeRenderer({ theme, state, onAssetChange }: Props) {
  const { palette } = theme;
  const sorted = [...theme.elements].sort((a, b) => a.zIndex - b.zIndex);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: palette.background, overflow: 'hidden' }}>
      {sorted.map(el => (
        <div
          key={el.id}
          style={{
            position: 'absolute',
            left: `${el.x}%`,
            top: `${el.y}%`,
            width: `${el.width}%`,
            height: `${el.height}%`,
            zIndex: el.zIndex,
            overflow: 'hidden',
            transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
            ...shapeClipStyle(el.style.shape),
          }}
        >
          <ThemeElementView element={el} theme={theme} state={state} onAssetChange={onAssetChange} />
        </div>
      ))}
    </div>
  );
}

function ThemeElementView({ element, theme, state, onAssetChange }: {
  element: HydratedThemeElement;
  theme: HydratedTheme;
  state: PlayerState;
  onAssetChange: (id: string) => void;
}) {
  const { palette, typography } = theme;
  const { style } = element;
  const color = resolveThemeColor(style.color, palette);
  const backgroundColor = resolveThemeColor(style.backgroundColor, palette);

  switch (element.kind) {
    case 'TEXT': {
      // translations are stored per-element for a future per-screen locale setting; today
      // the primary `text` is what renders, same as every other content field.
      const text = element.content.text;
      return (
        <div
          dir={style.direction ?? 'auto'}
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: style.textAlign === 'center' ? 'center' : style.textAlign === 'right' ? 'flex-end' : 'flex-start',
            textAlign: style.textAlign ?? 'left',
            color: color ?? palette.text,
            fontFamily: resolveFontFamily(style.fontFamily, typography),
            fontSize: style.fontSizePx ? `${style.fontSizePx}px` : undefined,
            fontWeight: style.fontWeight,
            opacity: style.opacity,
          }}
        >
          {text}
        </div>
      );
    }
    case 'IMAGE':
      return element.content.url ? (
        <img
          src={element.content.url}
          alt={element.label ?? ''}
          style={{ width: '100%', height: '100%', objectFit: style.objectFit ?? 'fill', borderRadius: style.borderRadius, opacity: style.opacity, ...mediaCropStyle(style) }}
        />
      ) : (
        <ThemePlaceholder label={element.label ?? 'Image'} palette={palette} />
      );
    case 'VIDEO':
      return element.content.url ? (
        <video
          src={element.content.url}
          autoPlay
          loop
          muted
          playsInline
          style={{ width: '100%', height: '100%', objectFit: style.objectFit ?? 'contain', borderRadius: style.borderRadius, opacity: style.opacity, ...mediaCropStyle(style) }}
        />
      ) : (
        <ThemePlaceholder label={element.label ?? 'Video'} palette={palette} />
      );
    case 'DOCUMENT':
      return element.content.pageUrls.length > 0 ? (
        <DocumentPager
          pageUrls={element.content.pageUrls}
          secondsPerPage={element.content.secondsPerPage}
          style={{ objectFit: style.objectFit ?? 'contain', borderRadius: style.borderRadius, opacity: style.opacity }}
        />
      ) : (
        <ThemePlaceholder label={element.label ?? 'Document'} palette={palette} />
      );
    case 'PLAYLIST':
      return element.content.playlist ? (
        <div style={{ width: '100%', height: '100%', borderRadius: style.borderRadius, overflow: 'hidden' }}>
          <ZonePlayer playlist={element.content.playlist} onAssetChange={onAssetChange} />
        </div>
      ) : (
        <ThemePlaceholder label={element.label ?? 'Media'} palette={palette} />
      );
    case 'SHAPE':
      if (style.shapeFill === 'outline') {
        return <ShapeOutline shape={style.shape} color={backgroundColor ?? palette.text} strokeWidthPx={style.strokeWidthPx} opacity={style.opacity} />;
      }
      return <div style={{ width: '100%', height: '100%', backgroundColor: backgroundColor ?? 'transparent', borderRadius: style.borderRadius, opacity: style.opacity }} />;
    case 'BRUSH':
      return (
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%', display: 'block', opacity: style.opacity }}>
          <polyline
            points={brushPolylinePoints(element.content.points)}
            fill="none"
            stroke={backgroundColor ?? palette.text}
            strokeWidth={style.strokeWidthPx ?? 4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'WIDGET':
      return <LiveWidget widgetType={element.content.widgetType} widgetConfig={element.content.widgetConfig} state={state} />;
    default:
      return null;
  }
}

// Renders `shapeFill: 'outline'` as a stroked ring/silhouette instead of a solid fill — a plain
// CSS `border` on a clip-path'd box only follows the box's rectangular edge, not an arbitrary
// polygon, so arrow/star/pentagon/etc. need a real SVG stroke to look like a clean outline.
function ShapeOutline({ shape, color, strokeWidthPx, opacity }: {
  shape: string | undefined;
  color: string;
  strokeWidthPx: number | undefined;
  opacity: number | undefined;
}) {
  const geo = shapeOutlineGeometry(shape as Parameters<typeof shapeOutlineGeometry>[0]);
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

// A DOCUMENT element has no playlist wrapping it (unlike a MEDIA zone's DOCUMENT item), so it
// keeps its own page timer here and loops forever — the self-contained-timer pattern already
// used by TickerWidget/PrayerZoneWidget for widgets with no external "next item" to hand off to.
function DocumentPager({ pageUrls, secondsPerPage, style }: {
  pageUrls: string[];
  secondsPerPage: number;
  style: { objectFit: 'contain' | 'cover' | 'fill'; borderRadius?: number; opacity?: number };
}) {
  const [pageIndex, setPageIndex] = useState(0);

  useEffect(() => {
    setPageIndex(0);
    if (pageUrls.length < 2) return;
    const id = setInterval(() => setPageIndex(p => (p + 1) % pageUrls.length), secondsPerPage * 1000);
    return () => clearInterval(id);
  }, [pageUrls, secondsPerPage]);

  return (
    <img
      src={pageUrls[pageIndex]}
      alt=""
      style={{ width: '100%', height: '100%', objectFit: style.objectFit, borderRadius: style.borderRadius, opacity: style.opacity }}
    />
  );
}

function ThemePlaceholder({ label, palette }: { label: string; palette: HydratedTheme['palette'] }) {
  return (
    <div style={{
      width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: palette.surface, color: palette.textMuted, border: `1px dashed ${palette.textMuted}`,
      fontFamily: 'system-ui, sans-serif', fontSize: '0.85rem', textAlign: 'center', padding: 8,
    }}>
      {label}
    </div>
  );
}
