import { useEffect, useRef } from 'react';

export type TickerDirection = 'LEFT_TO_RIGHT' | 'RIGHT_TO_LEFT' | 'TOP_TO_BOTTOM' | 'BOTTOM_TO_TOP';

interface Props {
  text: string;
  color: string;
  backgroundColor?: string;
  fontFamily: string;
  fontSize: string;
  direction: TickerDirection;
  speedPx: number; // px per second
  crossPosition?: number; // 0-100% along the axis perpendicular to scroll; 50 = centered (default)
}

const AXIS: Record<TickerDirection, 'x' | 'y'> = {
  LEFT_TO_RIGHT: 'x',
  RIGHT_TO_LEFT: 'x',
  TOP_TO_BOTTOM: 'y',
  BOTTOM_TO_TOP: 'y',
};
// +1 = transform grows with posRef (moves right/down), -1 = transform shrinks (moves left/up).
const SIGN: Record<TickerDirection, 1 | -1> = {
  LEFT_TO_RIGHT: 1,
  RIGHT_TO_LEFT: -1,
  TOP_TO_BOTTOM: 1,
  BOTTOM_TO_TOP: -1,
};

/** Scrolling variant of a TEXT asset — same styling knobs as the static render, but the content
 * enters from the edge matching `direction` and loops continuously, like the TICKER widget. */
export default function TextAssetTicker({ text, color, backgroundColor, fontFamily, fontSize, direction, speedPx, crossPosition = 50 }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const posRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  // Speed/crossPosition live in refs so tweaking them (e.g. live in the editor) doesn't restart
  // the RAF loop — only text/direction changes reset the entry animation.
  const speedRef = useRef(speedPx);
  const crossRef = useRef(crossPosition);
  const isVertical = AXIS[direction] === 'y';
  const sign = SIGN[direction];

  useEffect(() => { speedRef.current = speedPx; }, [speedPx]);
  useEffect(() => { crossRef.current = crossPosition; }, [crossPosition]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el || !text.trim()) return;

    // Start fully off-screen on the entry edge so the text visibly slides in, rather than
    // already sitting inside the zone — posRef only ever grows; `sign` decides which way that
    // growth reads on screen.
    const containerSize = isVertical ? el.clientHeight : el.clientWidth;
    posRef.current = -containerSize;
    lastTsRef.current = null;

    const tick = (ts: number) => {
      lastTsRef.current ??= ts;
      const dt = (ts - lastTsRef.current) / 1000;
      lastTsRef.current = ts;

      posRef.current += speedRef.current * dt;

      const inner = el.firstElementChild as HTMLElement | null;
      if (inner) {
        // Duplicated content (text + separator + text) — once we've scrolled through one full
        // copy, snap back by that width/height so the loop is seamless forever.
        const innerSize = (isVertical ? inner.scrollHeight : inner.scrollWidth) / 2;
        if (innerSize > 0 && posRef.current >= innerSize) posRef.current -= innerSize;
        const offset = sign * posRef.current;
        // The scroll axis moves by `offset` px every frame; the cross axis is pinned to a fixed
        // percent of the element's own size (via the matching top/left % below), so it stays put
        // as the animation runs.
        inner.style.transform = isVertical
          ? `translate(-${crossRef.current}%, ${offset}px)`
          : `translate(${offset}px, -${crossRef.current}%)`;
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, [text, isVertical, sign]);

  return (
    <div style={{ width: '100%', height: '100%', backgroundColor: backgroundColor ?? undefined, overflow: 'hidden', position: 'relative' }}>
      <div ref={viewportRef} style={{ width: '100%', height: '100%', overflow: 'hidden', position: 'relative' }}>
        {isVertical ? (
          // Cross axis is horizontal here — `left`/translateX position the block (shrink-wrapped,
          // capped at 92% width so long text still wraps) anywhere from flush-left to flush-right.
          <div style={{ position: 'absolute', top: 0, left: `${crossPosition}%`, width: 'max-content', maxWidth: '92%', padding: '0.5em 0', willChange: 'transform' }}>
            {[text, text].map((line, i) => (
              <div
                key={i}
                style={{ color, fontFamily, fontSize, padding: '0.35em 1em', whiteSpace: 'pre-wrap', wordBreak: 'break-word', textAlign: 'center' }}
              >
                {line}
              </div>
            ))}
          </div>
        ) : (
          // Cross axis is vertical here — `top`/translateY position the (nowrap, single-line)
          // text anywhere from flush-top to flush-bottom.
          <div style={{ position: 'absolute', top: `${crossPosition}%`, left: 0, whiteSpace: 'nowrap', color, fontFamily, fontSize, padding: '0 1em', willChange: 'transform' }}>
            {text}
            <span style={{ padding: '0 2em' }}>◆</span>
            {text}
          </div>
        )}
      </div>
    </div>
  );
}
