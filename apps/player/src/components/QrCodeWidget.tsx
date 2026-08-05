import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

interface Props {
  value?: string;
  color?: string;
  background?: string;
  // How much of the zone's box the code fills, centered — leaves a quiet margin by default so
  // the code isn't flush against the zone's own edges.
  sizePercent?: number;
}

export default function QrCodeWidget({ value, color = '#000000', background = '#ffffff', sizePercent = 90 }: Props) {
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    if (!value?.trim()) {
      setSvg(null);
      return;
    }
    let cancelled = false;
    QRCode.toString(value, { type: 'svg', margin: 1, color: { dark: color, light: background } })
      .then((markup) => {
        if (cancelled) return;
        // toString() hardcodes pixel width/height from the module count — stretch to the
        // container instead so the code scales cleanly with the zone's own box.
        setSvg(markup.replace('<svg ', '<svg width="100%" height="100%" '));
      })
      .catch(() => {
        if (!cancelled) setSvg(null);
      });
    return () => {
      cancelled = true;
    };
  }, [value, color, background]);

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxSizing: 'border-box',
      }}
    >
      {svg && (
        // Markup is generated locally by the qrcode library from our own config, not user-supplied HTML.
        <div style={{ width: `${sizePercent}%`, height: `${sizePercent}%` }} dangerouslySetInnerHTML={{ __html: svg }} />
      )}
    </div>
  );
}
