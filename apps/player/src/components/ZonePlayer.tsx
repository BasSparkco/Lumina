import { useEffect, useRef, useState } from 'react';
import type { Playlist, PlaylistItem } from '../lib/api';

interface Props {
  playlist: Playlist;
  onAssetChange?: (assetId: string) => void;
  volume?: number; // 0-100, screen/group-resolved; defaults to full volume
}

const FONT_FAMILY_STACKS: Record<string, string> = {
  SANS: 'system-ui, sans-serif',
  SERIF: 'Georgia, "Times New Roman", serif',
  MONOSPACE: '"Courier New", monospace',
  ROUNDED: 'ui-rounded, "SF Pro Rounded", "Segoe UI", sans-serif',
  CONDENSED: '"Arial Narrow", "Helvetica Neue Condensed", Arial, sans-serif',
  IMPACT: 'Impact, "Arial Black", sans-serif',
  HANDWRITTEN: '"Segoe Script", "Bradley Hand", "Comic Sans MS", cursive',
};

const FONT_SIZE_CLAMPS: Record<string, string> = {
  SMALL: 'clamp(1rem, 3vw, 2.5rem)',
  MEDIUM: 'clamp(1.5rem, 5vw, 5rem)',
  LARGE: 'clamp(2rem, 7vw, 7rem)',
  XLARGE: 'clamp(2.5rem, 9vw, 9rem)',
};

export default function ZonePlayer({ playlist, onAssetChange, volume = 100 }: Props) {
  const [index, setIndex] = useState(0);
  const [item, setItem] = useState<PlaylistItem | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    }
    // VIDEO: onEnded triggers advance

    // Preload next video
    const nextIdx = (index + 1) % playlist.items.length;
    const next = playlist.items[nextIdx];
    if (next?.asset.type === 'VIDEO' && next.asset.url && preloadRef.current) {
      preloadRef.current.src = next.asset.url;
      preloadRef.current.load();
    }

    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, playlist]);

  function advance() {
    setIndex(i => (i + 1) % playlist.items.length);
  }

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
              fontFamily: FONT_FAMILY_STACKS[item.asset.textFontFamily ?? 'SANS'],
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
          muted={item.muted}
          loop={playlist.items.length === 1}
          playsInline
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          onEnded={playlist.items.length === 1 ? undefined : advance}
        />
      )}
      <video ref={preloadRef} style={{ display: 'none' }} preload="auto" muted />
    </div>
  );
}
