import { useEffect, useRef, useState } from 'react';
import type { Playlist, PlaylistItem } from '../lib/api';

interface Props {
  playlist: Playlist;
  onAssetChange?: (assetId: string) => void;
}

export default function ZonePlayer({ playlist, onAssetChange }: Props) {
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

    if (current.asset.type === 'IMAGE') {
      timerRef.current = setTimeout(advance, current.durationSecs * 1000);
    }
    // VIDEO: onEnded triggers advance

    // Preload next video
    const nextIdx = (index + 1) % playlist.items.length;
    const next = playlist.items[nextIdx];
    if (next?.asset.type === 'VIDEO' && preloadRef.current) {
      preloadRef.current.src = next.asset.url;
      preloadRef.current.load();
    }

    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, playlist]);

  function advance() {
    setIndex(i => (i + 1) % playlist.items.length);
  }

  if (!item) return null;

  return (
    <div style={{ width: '100%', height: '100%', background: '#000', position: 'relative' }}>
      {item.asset.type === 'IMAGE' && (
        <img
          key={item.id}
          src={item.asset.url}
          alt={item.asset.name}
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      )}
      {item.asset.type === 'VIDEO' && (
        <video
          key={item.id}
          ref={videoRef}
          src={item.asset.url}
          autoPlay
          muted
          playsInline
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          onEnded={advance}
        />
      )}
      <video ref={preloadRef} style={{ display: 'none' }} preload="auto" muted />
    </div>
  );
}
