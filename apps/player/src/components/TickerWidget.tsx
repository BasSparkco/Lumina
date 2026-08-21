import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type TickerItem } from '../lib/api';
import { cache } from '../lib/db';

interface Props {
  // Exactly one of these is expected to be set — feedUrl for the RSS source, staticText for
  // free-typed content (one item per non-empty line). Both undefined renders nothing.
  feedUrl?: string;
  staticText?: string;
  direction?: 'horizontal' | 'vertical';
  scrollSpeedPx?: number; // px per second
  lang?: 'en' | 'ar';
}

export default function TickerWidget({ feedUrl, staticText, direction = 'horizontal', scrollSpeedPx = 80, lang = 'en' }: Props) {
  const [feedItems, setFeedItems] = useState<TickerItem[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const posRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const isRtl = lang === 'ar';
  const isVertical = direction === 'vertical';

  useEffect(() => {
    if (!feedUrl) { setFeedItems([]); return; }
    let alive = true;
    // Same offline-cache gap as WeatherWidget/CurrencyWidget — see WeatherWidget's comment.
    // `feedItems` starts at `[]` rather than `null`, so the guard here is `prev.length` instead
    // of `prev ??`.
    const cacheKey = `ticker:${feedUrl}`;
    void cache.getWidgetData<TickerItem[]>(cacheKey).then(cached => {
      if (alive && cached?.length) setFeedItems(prev => (prev.length ? prev : cached));
    });
    const load = async () => {
      try {
        const result = await api.getTicker(feedUrl);
        if (alive && result) setFeedItems(result.items);
        if (result) void cache.saveWidgetData(cacheKey, result.items);
      } catch { /* keep previous */ }
    };
    void load();
    const interval = setInterval(() => { void load(); }, 5 * 60 * 1000); // refresh every 5m
    return () => { alive = false; clearInterval(interval); };
  }, [feedUrl]);

  // Static text takes priority when both are somehow set — one item per non-empty line.
  const items = useMemo<TickerItem[]>(() => {
    if (staticText) {
      return staticText.split('\n').map(line => line.trim()).filter(Boolean).map(title => ({ title, link: '' }));
    }
    return feedItems;
  }, [staticText, feedItems]);

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

      // Vertical always scrolls "up" (no RTL equivalent for a vertical axis).
      posRef.current += scrollSpeedPx * dt * (isVertical ? 1 : isRtl ? -1 : 1);

      const inner = el.firstElementChild as HTMLElement | null;
      if (inner) {
        if (isVertical) {
          const innerH = inner.scrollHeight / 2; // duplicated content
          if (posRef.current >= innerH) posRef.current -= innerH;
          inner.style.transform = `translateY(${-posRef.current}px)`;
        } else {
          const innerW = inner.scrollWidth / 2; // duplicated content
          if (!isRtl && posRef.current >= innerW) posRef.current -= innerW;
          if (isRtl && posRef.current <= -innerW) posRef.current += innerW;
          inner.style.transform = `translateX(${-posRef.current}px)`;
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, [items, scrollSpeedPx, isRtl, isVertical]);

  const fontFamily = isRtl ? "'Amiri', 'Noto Sans Arabic', sans-serif" : "'Inter', system-ui, sans-serif";
  const separator = ' ◆ ';
  const joinedText = items.map(i => i.title).join(separator);
  const doubledText = joinedText + separator + joinedText;

  return (
    <div
      dir={isRtl ? 'rtl' : 'ltr'}
      style={{
        width: '100%',
        height: '100%',
        background: 'rgba(0,0,0,0.85)',
        color: '#fff',
        display: 'flex',
        alignItems: isVertical ? 'stretch' : 'center',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* Gradient fade edges — along whichever axis is scrolling */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: isVertical
            ? 'linear-gradient(180deg, rgba(0,0,0,0.8) 0%, transparent 10%, transparent 90%, rgba(0,0,0,0.8) 100%)'
            : 'linear-gradient(90deg, rgba(0,0,0,0.8) 0%, transparent 8%, transparent 92%, rgba(0,0,0,0.8) 100%)',
          zIndex: 1,
          pointerEvents: 'none',
        }}
      />

      <div ref={containerRef} style={{ overflow: 'hidden', width: '100%', height: '100%' }}>
        {isVertical ? (
          <div style={{ padding: '0.5em 1em', willChange: 'transform' }}>
            {[...items, ...items].map((item, i) => (
              <div
                key={i}
                style={{
                  fontFamily,
                  fontSize: 'clamp(0.75rem, 2.5vh, 1.4rem)',
                  padding: '0.35em 0',
                }}
              >
                {item.title}
              </div>
            ))}
          </div>
        ) : (
          <div
            style={{
              display: 'inline-block',
              whiteSpace: 'nowrap',
              fontFamily,
              fontSize: 'clamp(0.75rem, 2.5vh, 1.4rem)',
              padding: '0 1em',
              willChange: 'transform',
            }}
          >
            {doubledText}
          </div>
        )}
      </div>
    </div>
  );
}
