import { useEffect, useState } from 'react';
import { resolveThemeColor, resolveThemeFill, resolveThemeFillColor, fontStack, shapeClipStyle, brushPolylinePoints, mediaCropStyle, buildImageFilterCss, needsSvgImageFilter, buildEntranceAnimationStyle, buildEmphasisAnimationStyle, combineAnimationStyles } from '@lumina/types';
import { ShapeOutline, ImageAdjustmentFilter, ElementAnimationStyles, useTextReveal } from '@lumina/ui';
import type { HydratedTheme, HydratedThemeElement, PlayerState } from '../lib/api';
import ZonePlayer, { FONT_SIZE_CLAMPS } from './ZonePlayer';
import LiveWidget from './LiveWidget';
import TextAssetTicker from './TextAssetTicker';

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
      <ElementAnimationStyles />
      {sorted.map(el => (
        // Two nested divs, not one: entrance/emphasis animate via `transform` (translate/scale)
        // on the outer div, while rotation is its own static `transform: rotate()` on the inner
        // one — on the same element, the animation's `transform` keyframes would overwrite (not
        // compose with) the rotation for the animation's duration, and permanently wipe it once
        // `animation-fill-mode: both` locks in the keyframe's final value.
        <div
          key={el.id}
          style={{
            position: 'absolute',
            left: `${el.x}%`,
            top: `${el.y}%`,
            width: `${el.width}%`,
            height: `${el.height}%`,
            zIndex: el.zIndex,
            ...combineAnimationStyles(
              buildEntranceAnimationStyle(el.animation?.entrance),
              buildEmphasisAnimationStyle(el.animation?.emphasis),
            ),
          }}
        >
          <div
            style={{
              width: '100%',
              height: '100%',
              overflow: 'hidden',
              transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
              ...shapeClipStyle(el.style.shape),
            }}
          >
            <ThemeElementView element={el} theme={theme} state={state} onAssetChange={onAssetChange} />
          </div>
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
  const backgroundFill = resolveThemeFill(style.backgroundColor, palette);
  const backgroundColor = resolveThemeFillColor(style.backgroundColor, palette);
  // Called unconditionally (rules of hooks) even for non-TEXT elements / asset-backed TEXT
  // (which doesn't support reveal — see the TEXT case below), with inert '' / undefined inputs.
  const revealedText = useTextReveal(
    element.kind === 'TEXT' ? element.content.text : '',
    element.kind === 'TEXT' ? element.animation?.textReveal : undefined,
  );

  switch (element.kind) {
    case 'TEXT': {
      // An assetId means this element reuses a TEXT-type Asset's own content AND styling
      // as-is (font/color/size/background/ticker) — same model as IMAGE/VIDEO/DOCUMENT
      // elements reusing an asset's pixels/frames — instead of the literal `text`/style.* below.
      if (element.content.assetId && element.content.textContent != null) {
        const c = element.content;
        return c.textTickerEnabled ? (
          <TextAssetTicker
            text={c.textContent ?? ''}
            color={c.textColor ?? '#fff'}
            backgroundColor={c.textBackgroundColor ?? undefined}
            fontFamily={fontStack(c.textFontFamily)}
            fontSize={FONT_SIZE_CLAMPS[c.textSize ?? 'MEDIUM'] ?? FONT_SIZE_CLAMPS['MEDIUM']!}
            direction={c.textTickerDirection ?? 'RIGHT_TO_LEFT'}
            speedPx={c.textTickerSpeed ?? 80}
            crossPosition={c.textTickerCrossOffset ?? 50}
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '5%',
              boxSizing: 'border-box',
              backgroundColor: c.textBackgroundColor ?? undefined,
            }}
          >
            <p
              style={{
                color: c.textColor ?? '#fff',
                fontFamily: fontStack(c.textFontFamily),
                fontSize: FONT_SIZE_CLAMPS[c.textSize ?? 'MEDIUM'],
                textAlign: 'center',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                margin: 0,
              }}
            >
              {c.textContent}
            </p>
          </div>
        );
      }
      // translations are stored per-element for a future per-screen locale setting; today
      // the primary `text` is what renders, same as every other content field.
      const text = revealedText;
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
    case 'IMAGE': {
      const svgFilterId = `img-adj-${element.id}`;
      const filter = [
        style.imageAdjustments && needsSvgImageFilter(style.imageAdjustments) ? `url(#${svgFilterId})` : null,
        buildImageFilterCss(style.imageAdjustments),
      ].filter(Boolean).join(' ') || undefined;
      return element.content.url ? (
        <>
          {style.imageAdjustments && <ImageAdjustmentFilter id={svgFilterId} adjustments={style.imageAdjustments} />}
          <img
            src={element.content.url}
            alt={element.label ?? ''}
            style={{ width: '100%', height: '100%', objectFit: style.objectFit ?? 'fill', borderRadius: style.borderRadius, opacity: style.opacity, filter, ...mediaCropStyle(style) }}
          />
        </>
      ) : (
        <ThemePlaceholder label={element.label ?? 'Image'} palette={palette} />
      );
    }
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
      return <div style={{ width: '100%', height: '100%', background: backgroundFill ?? 'transparent', borderRadius: style.borderRadius, opacity: style.opacity }} />;
    case 'BRUSH':
      // The paint layer's raster bitmap takes priority — every theme drawn with the current
      // editor has this. `points` only still renders for themes saved before the raster paint
      // layer existed (a plain vector stroke, never produced by the editor anymore).
      return element.content.raster ? (
        // eslint-disable-next-line @next/next/no-img-element -- data URL, not a static/local image
        <img
          src={element.content.raster.dataUrl}
          alt=""
          style={{ width: '100%', height: '100%', display: 'block', objectFit: 'fill', opacity: style.opacity }}
        />
      ) : (
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
    case 'ICON':
      // Self-contained (sanitized SVG stored inline at pick time in the editor, see the ICON
      // element kind in @lumina/types) — no assetId/hydration, so playback never depends on
      // Iconify being reachable. Recolored via `color`, same as TEXT — the stored markup uses
      // currentColor for its fill/stroke.
      return (
        <div
          style={{ width: '100%', height: '100%', color: color ?? palette.text, opacity: style.opacity }}
          dangerouslySetInnerHTML={{ __html: element.content.svg }}
        />
      );
    default:
      return null;
  }
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
