import { resolveThemeColor } from '@lumina/types';
import type { HydratedTheme, HydratedThemeElement, PlayerState } from '../lib/api';
import ZonePlayer from './ZonePlayer';
import LiveWidget from './LiveWidget';

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
            fontFamily: (style.fontFamily === 'heading' ? typography.headingFont
              : style.fontFamily === 'body' ? typography.bodyFont
              : style.fontFamily) ?? typography.bodyFont ?? 'inherit',
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
          style={{ width: '100%', height: '100%', objectFit: style.objectFit ?? 'contain', borderRadius: style.borderRadius, opacity: style.opacity }}
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
          style={{ width: '100%', height: '100%', objectFit: style.objectFit ?? 'contain', borderRadius: style.borderRadius, opacity: style.opacity }}
        />
      ) : (
        <ThemePlaceholder label={element.label ?? 'Video'} palette={palette} />
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
      return <div style={{ width: '100%', height: '100%', backgroundColor: backgroundColor ?? 'transparent', borderRadius: style.borderRadius, opacity: style.opacity }} />;
    case 'WIDGET':
      return <LiveWidget widgetType={element.content.widgetType} widgetConfig={element.content.widgetConfig} state={state} />;
    default:
      return null;
  }
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
