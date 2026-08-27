import type { CSSProperties } from 'react';
import type { DesignDocument, DesignElement } from '@lumina/design-schema';
import { ImageIcon, Film, QrCode } from 'lucide-react';

// Cheap, live scaled-down re-render of a design's first scene for grid-card previews — same
// "percentage-positioned boxes at a small scale" convention ThemesSection's renderPreviewElements
// already uses for Theme cards, not a cached screenshot: always in sync with the actual content,
// no upload/storage pipeline, no extra network round trip (the full designJson is already part of
// the designs list payload). `containerType: 'inline-size'` + `cqw`-unit font sizes below make
// text scale with however wide the card actually renders, with no JS measurement needed.
//
// Image/video elements only carry an `assetId` (no resolved URL ships with the list payload), so
// they render as a generic placeholder rather than resolving N asset URLs per grid render.
export function DesignPreview({ document }: { document: DesignDocument }) {
  const scene = document.scenes[0];
  if (!scene) return null;
  const { width: canvasW, height: canvasH, backgroundColor } = document.canvas;
  const bg = scene.background.type === 'color' ? scene.background.color : backgroundColor;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: bg, containerType: 'inline-size' }}>
      {[...scene.elements]
        .filter((el) => el.visible !== false)
        .sort((a, b) => a.zIndex - b.zIndex)
        .map((el) => (
          <PreviewElement key={el.id} el={el} canvasW={canvasW} canvasH={canvasH} />
        ))}
    </div>
  );
}

function PreviewElement({ el, canvasW, canvasH }: { el: DesignElement; canvasW: number; canvasH: number }) {
  const box: CSSProperties = {
    position: 'absolute',
    left: `${(el.x / canvasW) * 100}%`,
    top: `${(el.y / canvasH) * 100}%`,
    width: `${(el.width / canvasW) * 100}%`,
    height: `${(el.height / canvasH) * 100}%`,
    opacity: el.opacity,
    transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
    overflow: 'hidden',
  };

  if (el.type === 'text') {
    return (
      <div
        style={{
          ...box,
          display: 'flex',
          alignItems: 'center',
          justifyContent: el.textAlign === 'center' ? 'center' : el.textAlign === 'right' ? 'flex-end' : 'flex-start',
          color: el.fill,
          fontSize: `${(el.fontSize / canvasW) * 100}cqw`,
          fontWeight: el.fontWeight,
          textAlign: el.textAlign,
          direction: el.direction,
          lineHeight: 1.15,
        }}
      >
        <span style={{ width: '100%', whiteSpace: 'pre-wrap' }}>{el.text}</span>
      </div>
    );
  }

  if (el.type === 'shape') {
    const borderRadius = el.shape === 'circle' || el.shape === 'ellipse' ? '50%' : el.shape === 'rounded-rectangle' ? '18%' : undefined;
    return (
      <div
        style={{
          ...box,
          background: el.fill ?? 'transparent',
          border: el.stroke ? `1px solid ${el.stroke}` : undefined,
          borderRadius,
        }}
      />
    );
  }

  if (el.type === 'image') {
    return (
      <div style={{ ...box, background: 'rgba(148,163,184,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <ImageIcon style={{ width: '35%', height: '35%', opacity: 0.6 }} />
      </div>
    );
  }

  if (el.type === 'video') {
    return (
      <div style={{ ...box, background: 'rgba(148,163,184,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Film style={{ width: '35%', height: '35%', opacity: 0.6 }} />
      </div>
    );
  }

  // qr
  return (
    <div style={{ ...box, background: el.backgroundColor, border: `1px solid ${el.foregroundColor}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <QrCode style={{ width: '50%', height: '50%', color: el.foregroundColor }} />
    </div>
  );
}
