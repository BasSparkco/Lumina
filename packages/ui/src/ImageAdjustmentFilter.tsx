import { needsSvgImageFilter, type ThemeImageAdjustments } from '@lumina/types';

export { needsSvgImageFilter };

interface ImageAdjustmentFilterProps {
  /** Unique per element (e.g. the element id) — becomes the <filter> id referenced by
   * `filter: url(#id)` at the call site. Two elements must never share one: a duotone filter's
   * color-table values are baked into this def, not passed as CSS custom properties. */
  id: string;
  adjustments: ThemeImageAdjustments;
}

function hexChannel(hex: string, channel: 'r' | 'g' | 'b'): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0.5; // non-hex (e.g. an unresolved palette ref) — mid-gray fallback, never crashes
  const offset = channel === 'r' ? 0 : channel === 'g' ? 2 : 4;
  return parseInt(m[1]!.slice(offset, offset + 2), 16) / 255;
}

// Renders the hidden <filter> def that backs the temperature/tint/duotone half of image
// adjustments (see buildImageFilterCss/needsSvgImageFilter in @lumina/theme.ts for the plain-CSS
// half) — shared between the dashboard's ThemeCanvasPanel and the player's ThemeRenderer so both
// grade an image identically. Rendered once per element that needs it, alongside (not instead of)
// the element's own <img>, and referenced from that <img>'s `filter: url(#id)`.
export function ImageAdjustmentFilter({ id, adjustments }: ImageAdjustmentFilterProps) {
  if (!needsSvgImageFilter(adjustments)) return null;
  const { duotone, temperature, tint } = adjustments;

  return (
    <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden focusable={false}>
      <defs>
        <filter id={id} colorInterpolationFilters="sRGB">
          {duotone ? (
            <>
              {/* Standard luminance weights collapse the image to grayscale (replicated into all
                  three channels) before the table lookup below maps it to the two duotone colors. */}
              <feColorMatrix
                type="matrix"
                values="0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0 0 0 1 0"
              />
              <feComponentTransfer>
                <feFuncR type="table" tableValues={`${hexChannel(duotone.color1, 'r')} ${hexChannel(duotone.color2, 'r')}`} />
                <feFuncG type="table" tableValues={`${hexChannel(duotone.color1, 'g')} ${hexChannel(duotone.color2, 'g')}`} />
                <feFuncB type="table" tableValues={`${hexChannel(duotone.color1, 'b')} ${hexChannel(duotone.color2, 'b')}`} />
              </feComponentTransfer>
            </>
          ) : (
            // Approximated warm/cool + green/magenta shift via a channel-offset matrix (see the
            // schema comment on temperature/tint in @lumina/theme.ts) — the 5th column of a
            // feColorMatrix row adds a constant to that channel.
            <feColorMatrix
              type="matrix"
              values={`1 0 0 0 ${(temperature / 100) * 0.2}  0 1 0 0 ${(-tint / 100) * 0.2}  0 0 1 0 ${(-temperature / 100) * 0.2}  0 0 0 1 0`}
            />
          )}
        </filter>
      </defs>
    </svg>
  );
}
