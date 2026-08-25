import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { AppAsset } from '../lib/api';
import { onAudioUnlock } from '../lib/audioUnlock';

export interface AppPlayerHandle {
  pause: () => void;
  resume: () => void;
  seek: (toSeconds: number) => void;
  setSpeed: (rate: number) => void;
}

interface Props {
  appAsset: AppAsset;
  onAssetChange?: (assetId: string) => void;
  // Mirrors ZonePlayer's/the <video> element's same-named props/attribute — the playlist item's
  // muted flag (ORed with zone audio-priority), and the screen/group-resolved volume (0-100).
  muted?: boolean;
  volume?: number;
  // Custom Player (appsroadmap.md Phase 12) — mirrors ZonePlayer's same-named props. Only ever
  // passed true for the single top-level instance backing StreamingType.APPS.
  controllable?: boolean;
  onPlaybackProgress?: (progress: { currentTime: number; duration: number; paused: boolean; rate: number }) => void;
}

// Minimal surface of the YouTube IFrame Player API actually used here — hand-rolled rather than
// pulling in a full @types/youtube dependency for half a dozen methods. Loaded from
// https://www.youtube.com/iframe_api, which attaches `YT` to `window` itself (not an ES module).
interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setPlaybackRate(rate: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  getPlaybackRate(): number;
  loadVideoById(videoId: string): void;
  destroy(): void;
  mute(): void;
  unMute(): void;
  setVolume(volume: number): void;
}
interface YTPlayerEvent {
  target: YTPlayer;
  data?: number;
}
interface YTNamespace {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string;
      playerVars?: Record<string, number | string>;
      events?: {
        onReady?: (e: YTPlayerEvent) => void;
        onStateChange?: (e: YTPlayerEvent) => void;
        onError?: (e: YTPlayerEvent) => void;
      };
    },
  ) => YTPlayer;
}
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

// Documented YT.PlayerState values (https://developers.google.com/youtube/iframe_api_reference) —
// kept as local constants rather than reading them off window.YT.PlayerState so the "is it
// playing" check below doesn't need YT to still be in scope by the time it runs.
const YT_STATE_ENDED = 0;
const YT_STATE_PLAYING = 1;

// Documented YT.Player onError codes. 101 and 150 are the same case (embedding disallowed by the
// video's owner) under two different historical codes — YouTube has never unified them.
const YT_ERROR_MESSAGES: Record<number, string> = {
  2: "This video's link isn't valid.",
  5: 'This video failed to load in the embedded player.',
  100: 'This video was removed or made private.',
  101: "This video's owner has disabled it from playing in embedded players like this one.",
  150: "This video's owner has disabled it from playing in embedded players like this one.",
};
const DEFAULT_ERROR_MESSAGE = "This video isn't available.";
// How long the error message stays up before a playlist auto-skips past the broken item — long
// enough to be readable on a signage display, short enough that one bad video doesn't eat a full
// rotation slot. A single (non-playlist) video just stays on the message — there's nothing to
// skip to.
const ERROR_SKIP_DELAY_MS = 6_000;

let ytApiPromise: Promise<YTNamespace> | null = null;
// Loads the IFrame API script once and shares the promise across every AppPlayer mount — the
// script attaches a single global `window.YT`, so there's nothing to gain from loading it twice,
// and the API's own callback contract (a single window.onYouTubeIframeAPIReady) only really
// supports one in-flight load at a time anyway.
function loadYouTubeIframeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise(resolve => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(window.YT!);
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(script);
  });
  return ytApiPromise;
}

function videoIdFromEmbedUrl(embedUrl: string): string {
  return embedUrl.split('/').pop() ?? '';
}

// Fisher-Yates — shuffled once when a SHUFFLE playlist mounts/changes, not re-shuffled every
// loop back to the start (simplest interpretation of "shuffle" for a first version).
function shuffled<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

function AppPlayer(
  { appAsset, onAssetChange, muted = false, volume = 100, controllable = false, onPlaybackProgress }: Props,
  ref: React.Ref<AppPlayerHandle>,
) {
  const config = appAsset.appConfig;
  const clampedVolume = Math.max(0, Math.min(100, volume));

  useEffect(() => {
    onAssetChange?.(appAsset.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appAsset.id]);

  const orderedItems = useMemo(() => {
    if (config?.kind !== 'playlist') return [];
    return config.playbackOrder === 'SHUFFLE' ? shuffled(config.items) : config.items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.kind === 'playlist' ? config.items : null, config?.kind === 'playlist' ? config.playbackOrder : null]);

  const [index, setIndex] = useState(0);
  useEffect(() => { setIndex(0); }, [orderedItems]);

  function advance() {
    if (!orderedItems.length) return;
    setIndex(i => (i + 1) % orderedItems.length);
  }

  const currentEmbedUrl = config?.kind === 'video' ? config.embedUrl : orderedItems[index]?.embedUrl;
  const videoId = currentEmbedUrl ? videoIdFromEmbedUrl(currentEmbedUrl) : '';

  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const [ready, setReady] = useState(false);
  // Read by the mount effect below (which is deliberately not keyed on muted/volume — see its
  // own comment) so it always sees the latest desired state without needing to tear the iframe
  // down and rebuild it every time a zone's audio-priority or the screen volume changes.
  const mutedRef = useRef(muted);
  const volumeRef = useRef(clampedVolume);
  useEffect(() => { mutedRef.current = muted; volumeRef.current = clampedVolume; }, [muted, clampedVolume]);
  // Set by the Custom Player's pause() below — checked by the audio-unlock retry effect so an
  // explicit pause isn't undone by the page's first interaction happening afterward.
  const pausedRef = useRef(false);
  // Set when YouTube reports this video can't play here (removed, private, or — most commonly —
  // embedding disabled by the owner, which no embed technique can work around). Previously
  // nothing handled this at all: the screen just got stuck showing YouTube's own broken-looking
  // "Video unavailable / Watch on YouTube" overlay indefinitely, with a playlist unable to
  // advance past it.
  const [error, setError] = useState<number | null>(null);

  // Mounts one YT.Player per Asset (not per playlist item — see the loadVideoById effect below
  // for how item changes are handled without tearing the embed down). A single video loops
  // itself natively via playerVars, the same trick the old bare-iframe src used.
  useEffect(() => {
    if (!videoId || !containerRef.current) return;
    let cancelled = false;
    let player: YTPlayer | null = null;
    setReady(false);
    setError(null);
    pausedRef.current = false;
    void loadYouTubeIframeApi().then(YT => {
      if (cancelled || !containerRef.current) return;
      const wantsMuted = mutedRef.current;
      player = new YT.Player(containerRef.current, {
        videoId,
        playerVars: {
          autoplay: 1, mute: wantsMuted ? 1 : 0, controls: 0, modestbranding: 1, rel: 0, playsinline: 1,
          ...(config?.kind === 'video' ? { loop: 1, playlist: videoId } : {}),
        },
        events: {
          onReady: e => {
            e.target.setVolume(volumeRef.current);
            e.target.playVideo();
            setReady(true);
            // Browsers block unmuted autoplay without prior user interaction — YouTube's own
            // iframe doesn't reliably signal that back to us, so give it a moment to actually
            // start and, if it didn't, fall back to muted playback rather than leaving it
            // stalled. Mirrors ZonePlayer's <video> autoplay fallback.
            if (!wantsMuted) {
              setTimeout(() => {
                if (cancelled) return;
                if (e.target.getPlayerState() !== YT_STATE_PLAYING) {
                  e.target.mute();
                  e.target.playVideo();
                }
              }, 800);
            }
          },
          // Real "video ended" detection — the fixed 60s-per-item timer this replaced (see
          // appsroadmap.md Phase 8/12) was only ever a stand-in for this.
          onStateChange: e => { if (e.data === YT_STATE_ENDED) advance(); },
          onError: e => setError(e.data ?? -1),
        },
      });
      playerRef.current = player;
    });
    return () => {
      cancelled = true;
      player?.destroy();
      playerRef.current = null;
    };
    // Deliberately keyed on appAsset.id, not videoId — a playlist's item changes (index) reuse
    // this same player instance via loadVideoById below rather than remounting the iframe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appAsset.id]);

  useEffect(() => {
    if (!ready || !playerRef.current || !videoId) return;
    setError(null);
    playerRef.current.loadVideoById(videoId);
  }, [videoId, ready]);

  // Pushes a muted/volume prop change (zone audio-priority flipping, screen/group volume edited
  // in the dashboard) onto the already-mounted player — mirrors ZonePlayer's own volume effect.
  useEffect(() => {
    if (!ready || !playerRef.current) return;
    if (muted) playerRef.current.mute();
    else { playerRef.current.unMute(); playerRef.current.setVolume(clampedVolume); }
  }, [muted, clampedVolume, ready]);

  // If unmuted autoplay got blocked (see the onReady fallback above), keep watching for the
  // page's first interaction — a tap on a touch kiosk, or an installer's one-time setup tap —
  // and retry unmuted the moment it happens. See audioUnlock.ts.
  useEffect(() => {
    if (muted) return;
    return onAudioUnlock(() => {
      const p = playerRef.current;
      if (!p || pausedRef.current) return;
      p.unMute();
      p.setVolume(clampedVolume);
      p.playVideo();
    });
  }, [muted, clampedVolume]);

  // A broken single item shouldn't stall a whole custom playlist forever — skip past it after
  // giving the message time to actually be read on a signage display. A lone (non-playlist)
  // video has nowhere to skip to, so it just stays on the message.
  useEffect(() => {
    if (error === null || orderedItems.length === 0) return;
    const id = setTimeout(advance, ERROR_SKIP_DELAY_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);

  // Custom Player (Phase 12): pause/resume/seek/setSpeed act directly on the YT.Player — a no-op
  // before it's ready since playerRef.current is null until onReady fires.
  useImperativeHandle(ref, () => ({
    pause: () => { pausedRef.current = true; playerRef.current?.pauseVideo(); },
    resume: () => { pausedRef.current = false; playerRef.current?.playVideo(); },
    seek: (toSeconds: number) => playerRef.current?.seekTo(toSeconds, true),
    setSpeed: (rate: number) => playerRef.current?.setPlaybackRate(rate),
  }), []);

  // Reports position ~1x/second, same shape and cadence as ZonePlayer's equivalent — see that
  // component for why this is gated on `controllable` rather than always running.
  useEffect(() => {
    if (!controllable || !onPlaybackProgress || !ready || error !== null) return;
    const id = setInterval(() => {
      const p = playerRef.current;
      if (!p) return;
      onPlaybackProgress({
        currentTime: p.getCurrentTime(),
        duration: p.getDuration(),
        paused: p.getPlayerState() !== YT_STATE_PLAYING,
        rate: p.getPlaybackRate(),
      });
    }, 1000);
    return () => clearInterval(id);
  }, [controllable, onPlaybackProgress, ready, error]);

  if (!config || !videoId) return null;

  return (
    <div style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', background: '#000' }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      {/* Covers YouTube's own broken-looking "Video unavailable / Watch on YouTube" overlay with
          something legible on a signage display and no dead link to click. */}
      {error !== null && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', gap: '0.75rem', padding: '5%', textAlign: 'center',
          background: '#000', color: '#fff', fontFamily: 'system-ui, sans-serif',
        }}>
          <p style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>
            {YT_ERROR_MESSAGES[error] ?? DEFAULT_ERROR_MESSAGE}
          </p>
        </div>
      )}
    </div>
  );
}

export default forwardRef(AppPlayer);
