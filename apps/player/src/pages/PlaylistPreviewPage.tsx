import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { api, ApiError, type Playlist, type PlaylistItem, type PreviewPlaylist, type PreviewPlaylistItem } from '../lib/api';
import ZonePlayer from '../components/ZonePlayer';

// playsetting.md Phase 4 — a dashboard-triggered, read-only, manually-stepped preview (opened in
// a new tab via the Preview icon on the Playlists page). Only ASSET-kind items are handed to
// ZonePlayer: the preview token endpoint reuses the dashboard's light findOne shaping, which
// gives THEME/LAYOUT/DESIGN items just an {id, name} reference, not the full hydration
// (elements/zones/resolved payload) ZonePlayer/ThemeRenderer/DesignRenderer need to render them
// — see PreviewPlaylist in lib/api.ts. Those kinds get a placeholder card instead.
function toZonePlayerItem(item: PreviewPlaylistItem): PlaylistItem {
  return {
    id: item.id,
    position: 0,
    durationSecs: item.durationSecs,
    muted: item.muted,
    playFullVideo: item.playFullVideo,
    cropZoom: item.cropZoom,
    cropOffsetX: item.cropOffsetX,
    cropOffsetY: item.cropOffsetY,
    kind: 'ASSET',
    asset: item.asset,
    theme: null,
    layout: null,
    design: null,
  };
}

export default function PlaylistPreviewPage() {
  const [params] = useSearchParams();
  const playlistId = params.get('playlistId');
  const token = params.get('token');

  const [playlist, setPlaylist] = useState<PreviewPlaylist | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!playlistId || !token) { setError('Missing playlist or token in the preview link.'); return; }
    api.previewPlaylist(playlistId, token)
      .then(setPlaylist)
      .catch((e: unknown) => setError(e instanceof ApiError && e.status === 401
        ? 'This preview link has expired. Open Preview again from the dashboard.'
        : 'Could not load this playlist for preview.'));
  }, [playlistId, token]);

  // Keyboard stepping (← / →) alongside the on-screen buttons — cheap, expected affordance for
  // a "step through items" UI. Reads playlist.items.length off the closure directly (re-attached
  // whenever `playlist` changes, which only happens once in practice) rather than depending on
  // `next`/`prev` below, since those are defined after this component's early returns and a hook
  // can't come after a conditional return.
  useEffect(() => {
    const count = playlist?.items.length ?? 0;
    if (count < 2) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'ArrowRight') setIndex(i => (i + 1) % count);
      if (e.key === 'ArrowLeft') setIndex(i => (i - 1 + count) % count);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [playlist]);

  if (error) {
    return (
      <div style={{ width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000', color: '#fff', fontFamily: 'sans-serif', textAlign: 'center', padding: '5%' }}>
        {error}
      </div>
    );
  }

  if (!playlist) {
    return <div style={{ width: '100vw', height: '100vh', background: '#000' }} />;
  }

  if (playlist.items.length === 0) {
    return (
      <div style={{ width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000', color: '#888', fontFamily: 'sans-serif' }}>
        This playlist has no items.
      </div>
    );
  }

  const item = playlist.items[index]!;
  const count = playlist.items.length;
  const next = () => setIndex(i => (i + 1) % count);
  const prev = () => setIndex(i => (i - 1 + count) % count);

  // A single-item synthetic playlist reusing ZonePlayer as-is: with only one item, ZonePlayer's
  // own duration timer/advance() naturally no-ops (index stays 0) instead of trying to move to a
  // "next" item — so it plays/loops that one item in place and never fights this page's own
  // forward/back stepping between top-level items. Remounted (via `key`) on every navigation so
  // no video/timer state leaks across items.
  const singleItemPlaylist: Playlist = {
    id: `${playlist.id}:${item.id}`,
    name: playlist.name,
    scaleSettings: playlist.scaleSettings,
    items: item.kind === 'ASSET' ? [toZonePlayerItem(item)] : [],
  };

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#000', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 16, left: 16, padding: '4px 12px', borderRadius: 999, background: 'rgba(0,0,0,0.5)', color: '#fff', fontSize: '0.75rem', fontFamily: 'sans-serif', zIndex: 1 }}>
        {playlist.name}
      </div>
      {item.kind === 'ASSET' ? (
        <ZonePlayer key={item.id} playlist={singleItemPlaylist} />
      ) : (
        <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#888', fontFamily: 'sans-serif', gap: 8 }}>
          <p style={{ margin: 0, fontSize: '1.1rem' }}>{item.kind === 'THEME' ? item.theme?.name : item.kind === 'LAYOUT' ? item.layout?.name : item.design?.name}</p>
          <p style={{ margin: 0, fontSize: '0.85rem' }}>Preview isn&apos;t available for {item.kind.toLowerCase()} items yet.</p>
        </div>
      )}

      {count > 1 && (
        <>
          <button
            onClick={prev}
            aria-label="Previous item"
            style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', width: 40, height: 40, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.5)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
          >
            <ChevronLeft size={20} />
          </button>
          <button
            onClick={next}
            aria-label="Next item"
            style={{ position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)', width: 40, height: 40, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.5)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
          >
            <ChevronRight size={20} />
          </button>
          <div style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', padding: '4px 12px', borderRadius: 999, background: 'rgba(0,0,0,0.5)', color: '#fff', fontSize: '0.75rem', fontFamily: 'sans-serif' }}>
            {index + 1} / {count}
          </div>
        </>
      )}
    </div>
  );
}
