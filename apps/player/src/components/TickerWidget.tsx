import { useEffect, useRef, useState } from 'react';
import { api, type TickerItem } from '../lib/api';

interface Props {
  feedUrl: string;
  scrollSpeedPx?: number; // px per second
  lang?: 'en' | 'ar';
}

export default function TickerWidget({ feedUrl, scrollSpeedPx = 80, lang = 'en' }: Props) {
  const [items, setItems] = useState<TickerItem[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const posRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const isRtl = lang === 'ar';

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const result = await api.getTicker(feedUrl);
        if (alive && result) setItems(result.items);
      } catch { /* keep previous */ }
    };
    void load();
    const interval = setInterval(load, 5 * 60 * 1000); // refresh every 5m
    return () => { alive = false; clearInterval(interval); };
  }, [feedUrl]);

  // Smooth scroll animation
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !items.length) return;

    posRef.current = 0;
    lastTsRef.current = null;

    const tick = (ts: number) => {
      lastTsRef.current ??= ts;
      const dt = (ts - lastTsRef.current) / 1000;
      lastTsRef.current = ts;

      posRef.current += scrollSpeedPx * dt * (isRtl ? -1 : 1);

      // Loop when the inner content scrolled its own width
      const inner = el.firstElementChild as HTMLElement | null;
      if (inner) {
        const innerW = inner.scrollWidth / 2; // duplicated content
        if (!isRtl && posRef.current >= innerW) posRef.current -= innerW;
        if (isRtl && posRef.current <= -innerW) posRef.current += innerW;
        inner.style.transform = `translateX(${-posRef.current}px)`;
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, [items, scrollSpeedPx, isRtl]);

  const separator = isRtl ? ' ◆ ' : ' ◆ ';
  const text = items.map(i => i.title).join(separator);
  const doubled = text + separator + text;

  return (
    <div
      dir={isRtl ? 'rtl' : 'ltr'}
      style={{
        width: '100%',
        height: '100%',
        background: 'rgba(0,0,0,0.85)',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* Gradient fade edges */}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, rgba(0,0,0,0.8) 0%, transparent 8%, transparent 92%, rgba(0,0,0,0.8) 100%)', zIndex: 1, pointerEvents: 'none' }} />

      <div ref={containerRef} style={{ overflow: 'hidden', width: '100%' }}>
        <div
          style={{
            display: 'inline-block',
            whiteSpace: 'nowrap',
            fontFamily: isRtl ? "'Amiri', 'Noto Sans Arabic', sans-serif" : "'Inter', system-ui, sans-serif",
            fontSize: 'clamp(0.75rem, 2.5vh, 1.4rem)',
            padding: '0 1em',
            willChange: 'transform',
          }}
        >
          {doubled}
        </div>
      </div>
    </div>
  );
}
