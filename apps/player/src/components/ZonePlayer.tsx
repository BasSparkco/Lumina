import { useEffect, useRef, useState } from 'react';
import { fontStack, mediaCropStyle } from '@lumina/types';
import type { Playlist, PlaylistItem } from '../lib/api';

interface Props {
  playlist: Playlist;
  onAssetChange?: (assetId: string) => void;
  volume?: number; // 0-100, screen/group-resolved; defaults to full volume
  // Set when a sibling zone in the same layout has audio priority and this isn't it — ORed
  // with the item's own `muted` flag, never overrides it the other way (an item explicitly
  // muted stays muted regardless of priority).
  forceMuted?: boolean;
}

const FONT_SIZE_CLAMPS: Record<string, string> = {
  SMALL: 'clamp(1rem, 3vw, 2.5rem)',
  MEDIUM: 'clamp(1.5rem, 5vw, 5rem)',
  LARGE: 'clamp(2rem, 7vw, 7rem)',
  XLARGE: 'clamp(2.5rem, 9vw, 9rem)',
};

export default function ZonePlayer({ playlist, onAssetChange, volume = 100, forceMuted = false }: Props) {
  const [index, setIndex] = useState(0);
  const [item, setItem] = useState<PlaylistItem | null>(null);
  // Which page of a DOCUMENT item is currently showing — durationSecs doubles as "seconds per
  // page" for this type (see hydratePlaylist on the API side).
  const [pageIndex, setPageIndex] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pageTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const preloadRef = useRef<HTMLVideoElement | null>(null);

  // When playlist changes (publish command) reset to beginning
  useEffect(() => {
    setIndex(0);
  }, [playlist.id]);

  useEffect(() => {
    if (!playlist.items.length) return;
    const current = playlist.items[index % playlist.items.length];
    if (!current) return;
    setItem(current);
    onAssetChange?.(current.asset.id);

    if (timerRef.current) clearTimeout(timerRef.current);

    if (current.asset.type === 'IMAGE' || current.asset.type === 'TEXT') {
      timerRef.current = setTimeout(advance, current.durationSecs * 1000);
    } else if (current.asset.type === 'VIDEO' && !current.playFullVideo) {
      // Custom clip length — cap playback at durationSecs instead of waiting for the video's
      // own end. onEnded (below) still covers a clip shorter than durationSecs.
      timerRef.current = setTimeout(advance, current.durationSecs * 1000);
    }
    // VIDEO with playFullVideo: onEnded (below) triggers advance, no timer

    // Preload next video
    const nextIdx = (index + 1) % playlist.items.length;
    const next = playlist.items[nextIdx];
    if (next?.asset.type === 'VIDEO' && next.asset.url && preloadRef.current) {
      preloadRef.current.src = next.asset.url;
      preloadRef.current.load();
    }

    setPageIndex(0);

    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, playlist]);

  function advance() {
    setIndex(i => (i + 1) % playlist.items.length);
  }

  // DOCUMENT items cycle their own pages before handing off to advance() — mirrors how VIDEO's
  // onEnded hands off, except there's an internal "sub-item" (page) advance first.
  useEffect(() => {
    if (pageTimerRef.current) clearInterval(pageTimerRef.current);
    if (item?.asset.type !== 'DOCUMENT' || item.asset.pageUrls.length === 0) return;

    pageTimerRef.current = setInterval(() => {
      setPageIndex(p => {
        const next = p + 1;
        if (next < item.asset.pageUrls.length) return next;
        // Last page: hand off to the next playlist item, unless this is the only item — a
        // single-item playlist has nowhere to advance to (index would stay 0, so nothing would
        // ever reset the page), so loop the document's own pages instead.
        if (playlist.items.length > 1) {
          advance();
          return p;
        }
        return 0;
      });
    }, item.durationSecs * 1000);

    return () => { if (pageTimerRef.current) clearInterval(pageTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item]);

  // Browsers block unmuted autoplay without prior user interaction — if that
  // happens, fall back to muted playback rather than leaving the video paused.
  useEffect(() => {
    const el = videoRef.current;
    if (!el || item?.asset.type !== 'VIDEO') return;
    el.volume = Math.max(0, Math.min(1, volume / 100));
    el.play().catch(() => {
      if (!el.muted) {
        el.muted = true;
        void el.play();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item]);

  // `volume` has no JSX/DOM-attribute equivalent (unlike `muted`), so a volume-only change
  // (screen/group volume edited in the dashboard, no new item/src) needs its own effect to
  // push the value onto the still-mounted video element.
  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = Math.max(0, Math.min(1, volume / 100));
  }, [volume]);

  if (!item) return null;

  return (
    <div style={{ width: '100%', height: '100%', background: '#000', position: 'relative' }}>
      {item.asset.type === 'IMAGE' && (
        <img
          key={item.id}
          src={item.asset.url ?? undefined}
          alt={item.asset.name}
          crossOrigin="anonymous"
          style={{ width: '100%', height: '100%', objectFit: 'fill', ...mediaCropStyle(item) }}
        />
      )}
      {item.asset.type === 'DOCUMENT' && item.asset.pageUrls[pageIndex] && (
        <img
          key={`${item.id}-${pageIndex}`}
          src={item.asset.pageUrls[pageIndex]}
          alt={item.asset.name}
          crossOrigin="anonymous"
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      )}
      {item.asset.type === 'TEXT' && (
        <div
          key={item.id}
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '5%',
            boxSizing: 'border-box',
            // null = transparent, i.e. the container's own black shows through (the historical
            // look from before this field existed).
            backgroundColor: item.asset.textBackgroundColor ?? undefined,
          }}
        >
          <p
            style={{
              color: item.asset.textColor ?? '#fff',
              fontFamily: fontStack(item.asset.textFontFamily),
              fontSize: FONT_SIZE_CLAMPS[item.asset.textSize ?? 'MEDIUM'],
              textAlign: 'center',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              margin: 0,
            }}
          >
            {item.asset.textContent}
          </p>
        </div>
      )}
      {item.asset.type === 'VIDEO' && (
        <video
          key={item.id}
          ref={videoRef}
          src={item.asset.url ?? undefined}
          autoPlay
          muted={item.muted || forceMuted}
          loop={playlist.items.length === 1}
          playsInline
          crossOrigin="anonymous"
          style={{ width: '100%', height: '100%', objectFit: 'contain', ...mediaCropStyle(item) }}
          onEnded={playlist.items.length === 1 ? undefined : advance}
        />
      )}
      <video ref={preloadRef} style={{ display: 'none' }} preload="auto" muted />
    </div>
  );
}
