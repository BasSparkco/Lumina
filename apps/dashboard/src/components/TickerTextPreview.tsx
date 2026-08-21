import { useEffect, useRef } from 'react';
import type { TickerDirection } from '@/lib/api';

interface Props {
  text: string;
  color: string;
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
const SIGN: Record<TickerDirection, 1 | -1> = {
  LEFT_TO_RIGHT: 1,
  RIGHT_TO_LEFT: -1,
  TOP_TO_BOTTOM: 1,
  BOTTOM_TO_TOP: -1,
};

/** Mirrors the player's TextAssetTicker animation (same edge-entry + loop technique) so the
 * editor preview matches what actually plays. Speed lives in a ref so dragging the speed slider
 * updates the running animation in place instead of restarting/jumping. */
export function TickerTextPreview({ text, color, fontFamily, fontSize, direction, speedPx, crossPosition = 50 }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const posRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const speedRef = useRef(speedPx);
  const crossRef = useRef(crossPosition);
  const isVertical = AXIS[direction] === 'y';
  const sign = SIGN[direction];

  useEffect(() => { speedRef.current = speedPx; }, [speedPx]);
  useEffect(() => { crossRef.current = crossPosition; }, [crossPosition]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el || !text.trim()) return;

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
        const innerSize = (isVertical ? inner.scrollHeight : inner.scrollWidth) / 2;
        if (innerSize > 0 && posRef.current >= innerSize) posRef.current -= innerSize;
        const offset = sign * posRef.current;
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
    <div ref={viewportRef} style={{ width: '100%', height: '100%', overflow: 'hidden', position: 'relative' }}>
      {isVertical ? (
        <div style={{ position: 'absolute', top: 0, left: `${crossPosition}%`, width: 'max-content', maxWidth: '92%', willChange: 'transform' }}>
          {[text, text].map((line, i) => (
            <div key={i} style={{ color, fontFamily, fontSize, padding: '0.35em 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word', textAlign: 'center' }}>
              {line}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ position: 'absolute', top: `${crossPosition}%`, left: 0, display: 'inline-block', whiteSpace: 'nowrap', color, fontFamily, fontSize, willChange: 'transform' }}>
          {text}
          <span style={{ padding: '0 2em' }}>◆</span>
          {text}
        </div>
      )}
    </div>
  );
}
