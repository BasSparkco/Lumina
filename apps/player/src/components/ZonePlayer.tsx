import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { fontStack, mediaCropStyle, shapeClipStyle } from '@lumina/types';
import type { Playlist, PlaylistItem, PlayerState } from '../lib/api';
import TextAssetTicker from './TextAssetTicker';
import ThemeRenderer from './ThemeRenderer';
import AppPlayer from './AppPlayer';
import ZoneRenderer from './ZoneRenderer';
import { onAudioUnlock } from '../lib/audioUnlock';

interface Props {
  playlist: Playlist;
  // Only needed when this playlist can contain THEME/LAYOUT items (i.e. every real caller) —
  // THEME elements' widgets (prayer/weather/etc.) and LAYOUT zones both need the top-level
  // screen state, not just this playlist. Absent only for a bare/synthetic playlist that's
  // guaranteed ASSET-only (there are none left in practice, but the type stays honest).
  state?: PlayerState;
  onAssetChange?: (assetId: string) => void;
  volume?: number; // 0-100, screen/group-resolved; defaults to full volume
  // Set when a sibling zone in the same layout has audio priority and this isn't it — ORed
  // with the item's own `muted` flag, never overrides it the other way (an item explicitly
  // muted stays muted regardless of priority).
  forceMuted?: boolean;
  // Custom Player (appsroadmap.md Phase 9/10) — only ever passed true for the single top-level
  // instance backing StreamingType.ASSET (never zone-nested instances, never PLAYLIST/emergency
  // playback; see the roadmap's "Open questions" for why that scope was chosen). Enables the
  // imperative pause/resume/seek/setSpeed handle below and starts reporting playback position.
  controllable?: boolean;
  onPlaybackProgress?: (progress: { currentTime: number; duration: number; paused: boolean; rate: number }) => void;
}

export interface ZonePlayerHandle {
  pause: () => void;
  resume: () => void;
  seek: (toSeconds: number) => void;
  setSpeed: (rate: number) => void;
}

// Exported for ThemeRenderer's asset-backed TEXT element, which needs the same size mapping.
export const FONT_SIZE_CLAMPS: Record<string, string> = {
  SMALL: 'clamp(1rem, 3vw, 2.5rem)',
  MEDIUM: 'clamp(1.5rem, 5vw, 5rem)',
  LARGE: 'clamp(2rem, 7vw, 7rem)',
  XLARGE: 'clamp(2.5rem, 9vw, 9rem)',
};

function ZonePlayer({ playlist, state, onAssetChange, volume = 100, forceMuted = false, controllable = false, onPlaybackProgress }: Props, ref: React.Ref<ZonePlayerHandle>) {
  const [index, setIndex] = useState(0);
  const [item, setItem] = useState<PlaylistItem | null>(null);
  // Which page of a DOCUMENT item is currently showing — durationSecs doubles as "seconds per
  // page" for this type (see hydratePlaylist on the API side).
  const [pageIndex, setPageIndex] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pageTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const preloadRef = useRef<HTMLVideoElement | null>(null);
  // Tracks an explicit Custom Player pause across a state refetch of the same video — see the
  // autoplay effect below for why this can't just live in the `item` object itself.
  const pausedRef = useRef(false);
  const lastPlayedItemIdRef = useRef<string | null>(null);

  // When playlist changes (publish command) reset to beginning
  useEffect(() => {
    setIndex(0);
  }, [playlist.id]);

  useEffect(() => {
    if (!playlist.items.length) return;
    const current = playlist.items[index % playlist.items.length];
    if (!current) return;
    setItem(current);
    onAssetChange?.(current.kind === 'ASSET' && current.asset ? current.asset.id : current.id);

    if (timerRef.current) clearTimeout(timerRef.current);

    // THEME/LAYOUT items (and an APP-type ASSET item, same as IMAGE/TEXT) always use durationSecs
    // as a plain dwell timer — there's no "ended" event to wait for the way a VIDEO has.
    if (current.kind !== 'ASSET' || current.asset?.type === 'IMAGE' || current.asset?.type === 'TEXT' || current.asset?.type === 'APP') {
      timerRef.current = setTimeout(advance, current.durationSecs * 1000);
    } else if (current.asset?.type === 'VIDEO' && !current.playFullVideo) {
      // Custom clip length — cap playback at durationSecs instead of waiting for the video's
      // own end. onEnded (below) still covers a clip shorter than durationSecs.
      timerRef.current = setTimeout(advance, current.durationSecs * 1000);
    }
    // VIDEO with playFullVideo: onEnded (below) triggers advance, no timer
    // DOCUMENT: its own page-cycling effect below hands off to advance() once pages are done

    // Preload next video
    const nextIdx = (index + 1) % playlist.items.length;
    const next = playlist.items[nextIdx];
    if (next?.kind === 'ASSET' && next.asset?.type === 'VIDEO' && next.asset.url && preloadRef.current) {
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
    if (item?.kind !== 'ASSET' || item.asset?.type !== 'DOCUMENT' || item.asset.pageUrls.length === 0) return;
    const asset = item.asset;

    pageTimerRef.current = setInterval(() => {
      setPageIndex(p => {
        const next = p + 1;
        if (next < asset.pageUrls.length) return next;
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

  // Browsers block unmuted autoplay without prior user interaction — if that happens, fall back
  // to muted playback rather than leaving the video paused. When the item wasn't actually meant
  // to be muted, keep watching for the page's first interaction (a tap on a touch kiosk, or an
  // installer's one-time setup tap) and retry unmuted the moment it happens — see audioUnlock.ts.
  //
  // This effect is keyed on the whole `item` object (not just its id) because a playlist edit
  // republished while this exact item is playing (e.g. its duration changed) should still apply
  // live — but `state`/`playlist` are refetched wholesale on every heartbeat/publish/reconnect,
  // handing back a brand-new object graph even when nothing actually changed. lastItemIdRef lets
  // this effect tell "the same video, refetched" apart from "actually a different video," so a
  // Custom Player pause (imperative, untracked by React state) doesn't get silently undone the
  // next time state happens to refresh.
  useEffect(() => {
    const el = videoRef.current;
    if (!el || item?.kind !== 'ASSET' || item.asset?.type !== 'VIDEO') return;
    if (lastPlayedItemIdRef.current !== item.id) {
      lastPlayedItemIdRef.current = item.id;
      pausedRef.current = false;
    }
    const wantsMuted = item.muted || forceMuted;
    el.volume = Math.max(0, Math.min(1, volume / 100));
    if (pausedRef.current) return;
    el.play().catch(() => {
      if (!el.muted) {
        el.muted = true;
        void el.play();
      }
    });
    if (wantsMuted) return;
    return onAudioUnlock(() => {
      if (!videoRef.current || pausedRef.current) return;
      videoRef.current.muted = false;
      void videoRef.current.play().catch(() => undefined);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item]);

  // `volume` has no JSX/DOM-attribute equivalent (unlike `muted`), so a volume-only change
  // (screen/group volume edited in the dashboard, no new item/src) needs its own effect to
  // push the value onto the still-mounted video element.
  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = Math.max(0, Math.min(1, volume / 100));
  }, [volume]);

  // Custom Player (Phase 9/10): pause/resume/seek/setSpeed act directly on the <video> element —
  // a no-op when nothing's mounted (item isn't a VIDEO ASSET) since videoRef.current is then null.
  useImperativeHandle(ref, () => ({
    pause: () => { pausedRef.current = true; videoRef.current?.pause(); },
    resume: () => { pausedRef.current = false; void videoRef.current?.play(); },
    seek: (toSeconds: number) => { if (videoRef.current) videoRef.current.currentTime = toSeconds; },
    setSpeed: (rate: number) => { if (videoRef.current) videoRef.current.playbackRate = rate; },
  }), []);

  // Reports position ~1x/second while controllable and a video is actually mounted, so the
  // dashboard's Custom Player panel (Phase 11) can drive a live scrub bar. Deliberately gated on
  // `controllable` (only ever true for the single top-level ASSET-mode instance) rather than
  // running in every ZonePlayer — a layout with several video zones would otherwise report
  // several conflicting "positions" for the same screen.
  useEffect(() => {
    if (!controllable || !onPlaybackProgress || item?.kind !== 'ASSET' || item.asset?.type !== 'VIDEO') return;
    const id = setInterval(() => {
      const el = videoRef.current;
      if (!el) return;
      onPlaybackProgress({ currentTime: el.currentTime, duration: el.duration || 0, paused: el.paused, rate: el.playbackRate });
    }, 1000);
    return () => clearInterval(id);
  }, [controllable, onPlaybackProgress, item]);

  if (!item) return null;

  const asset = item.kind === 'ASSET' ? item.asset : null;

  return (
    <div style={{ width: '100%', height: '100%', background: '#000', position: 'relative' }}>
      {item.kind === 'THEME' && item.theme && state && (
        <ThemeRenderer theme={item.theme} state={state} onAssetChange={onAssetChange ?? (() => {})} />
      )}

      {item.kind === 'LAYOUT' && item.layout && state && (() => {
        // At most one zone should ever have audioPriority (the dashboard enforces this as a
        // single-select when editing a layout) — while it's set, every other zone gets forced
        // silent regardless of its own muted/volume settings.
        const priorityZone = item.layout.zones.find(z => z.audioPriority) ?? null;
        return item.layout.zones.map(zone => (
          <div
            key={zone.id}
            style={{
              position: 'absolute',
              left: `${zone.x}%`,
              top: `${zone.y}%`,
              width: `${zone.width}%`,
              height: `${zone.height}%`,
              zIndex: zone.zIndex,
              overflow: 'hidden',
              transform: zone.rotation ? `rotate(${zone.rotation}deg)` : undefined,
              ...shapeClipStyle(zone.shape),
            }}
          >
            <ZoneRenderer
              zone={zone}
              state={state}
              onAssetChange={onAssetChange ?? (() => {})}
              volume={zone.audioVolume ?? volume}
              forceMuted={priorityZone !== null && priorityZone.id !== zone.id}
            />
          </div>
        ));
      })()}

      {asset?.type === 'APP' && (
        <AppPlayer
          appAsset={asset}
          muted={item.muted || forceMuted}
          volume={volume}
          controllable={controllable}
          onPlaybackProgress={onPlaybackProgress}
        />
      )}

      {asset?.type === 'IMAGE' && (
        <img
          key={item.id}
          src={asset.url ?? undefined}
          alt={asset.name}
          crossOrigin="anonymous"
          style={{ width: '100%', height: '100%', objectFit: 'fill', ...mediaCropStyle(item) }}
        />
      )}
      {asset?.type === 'DOCUMENT' && asset.pageUrls[pageIndex] && (
        <img
          key={`${item.id}-${pageIndex}`}
          src={asset.pageUrls[pageIndex]}
          alt={asset.name}
          crossOrigin="anonymous"
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      )}
      {asset?.type === 'TEXT' && asset.textTickerEnabled && (
        <TextAssetTicker
          key={item.id}
          text={asset.textContent ?? ''}
          color={asset.textColor ?? '#fff'}
          backgroundColor={asset.textBackgroundColor ?? undefined}
          fontFamily={fontStack(asset.textFontFamily)}
          fontSize={FONT_SIZE_CLAMPS[asset.textSize ?? 'MEDIUM'] ?? FONT_SIZE_CLAMPS['MEDIUM']!}
          direction={asset.textTickerDirection}
          speedPx={asset.textTickerSpeed ?? 80}
          crossPosition={asset.textTickerCrossOffset ?? 50}
        />
      )}
      {asset?.type === 'TEXT' && !asset.textTickerEnabled && (
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
            backgroundColor: asset.textBackgroundColor ?? undefined,
          }}
        >
          <p
            style={{
              color: asset.textColor ?? '#fff',
              fontFamily: fontStack(asset.textFontFamily),
              fontSize: FONT_SIZE_CLAMPS[asset.textSize ?? 'MEDIUM'],
              textAlign: 'center',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              margin: 0,
            }}
          >
            {asset.textContent}
          </p>
        </div>
      )}
      {asset?.type === 'VIDEO' && (
        <video
          key={item.id}
          ref={videoRef}
          src={asset.url ?? undefined}
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

export default forwardRef(ZonePlayer);
