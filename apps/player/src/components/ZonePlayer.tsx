import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  fontStack, mediaCropStyle, shapeClipStyle,
  resolveEffectiveTransition, buildIncomingTransitionStyle, buildOutgoingTransitionStyle,
  DEFAULT_PLAYLIST_TRANSITION_DURATION_MS, type PlaylistTransitionDefinition,
} from '@lumina/types';
import { PlaylistTransitionStyles } from '@lumina/ui';
import type { Playlist, PlaylistItem, PlayerState } from '../lib/api';
import TextAssetTicker from './TextAssetTicker';
import ThemeRenderer from './ThemeRenderer';
import DesignRenderer from './DesignRenderer';
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

const VIDEO_PROGRESS_CHECK_MS = 2_000;
const VIDEO_STALL_TIMEOUT_MS = 10_000;
const VIDEO_START_TIMEOUT_MS = 120_000;
const MAX_LOCAL_VIDEO_RECOVERIES = 1;
const NOOP_ASSET_CHANGE = () => undefined;

// Explicitly tells the browser to give up this element's hardware decode session instead of
// waiting for garbage collection to get around to it whenever the element is detached from
// the DOM. Safe to call on an element that's already been unmounted — el.pause()/removeAttribute
// still work on a detached node. See the autoplay effect's cleanup for why this matters.
function releaseVideoDecoder(el: HTMLVideoElement) {
  el.pause();
  el.removeAttribute('src');
  el.load();
}

// Exported for ThemeRenderer's asset-backed TEXT element, which needs the same size mapping.
export const FONT_SIZE_CLAMPS: Record<string, string> = {
  SMALL: 'clamp(1rem, 3vw, 2.5rem)',
  MEDIUM: 'clamp(1.5rem, 5vw, 5rem)',
  LARGE: 'clamp(2rem, 7vw, 7rem)',
  XLARGE: 'clamp(2.5rem, 9vw, 9rem)',
};

// playsetting.md Phase 3 — the only three asset kinds Playlist.scaleSettings can override (the
// Settings modal only offers these; AUDIO/TEXT/APP have no frame-fit concept, see
// PlaylistSettingsModal's SCALABLE_TYPES). These are also this file's pre-existing hardcoded
// defaults, kept as the fallback so an unconfigured playlist renders exactly as it always has.
const DEFAULT_SCALE_FIT = { IMAGE: 'fill', VIDEO: 'contain', DOCUMENT: 'contain' } as const;

function scaleFit(playlist: Playlist, type: keyof typeof DEFAULT_SCALE_FIT): 'contain' | 'cover' | 'fill' {
  return playlist.scaleSettings?.[type] ?? DEFAULT_SCALE_FIT[type];
}

// Item transitions (§ below) briefly keep the outgoing item mounted underneath the incoming one
// so they can visually overlap (crossfade/slide/zoom/dissolve into each other). That's cheap and
// safe for IMAGE/TEXT/DOCUMENT — plain <img>/text markup, no hardware resource — but NOT for
// VIDEO (a second live decoder is a separate, hardware-tiered feature the preload-warmup above
// deliberately avoids) or THEME/LAYOUT/DESIGN/APP (each is a whole subtree with its own timers,
// widgets, zones, or iframe — mounting two live copies would double-run all of that). Those
// still get the incoming item's transition — just as a solo "enter" animation with nothing
// overlapping underneath it, see the render below.
function isLightweightTransitionable(candidate: PlaylistItem): boolean {
  return candidate.kind === 'ASSET' && (candidate.asset?.type === 'IMAGE' || candidate.asset?.type === 'TEXT' || candidate.asset?.type === 'DOCUMENT');
}

// The lightweight (IMAGE/TEXT/DOCUMENT) subset of the render below, factored out so the same
// markup can back both the current item and — while a transition is overlapping the previous one
// underneath it — the outgoing item. A pure function of (playlist, item, pageIndex): no component
// state, so it's equally valid for either layer.
function renderLightweightAssetBody(playlist: Playlist, bodyItem: PlaylistItem, bodyPageIndex: number) {
  if (bodyItem.kind !== 'ASSET' || !bodyItem.asset) return null;
  const asset = bodyItem.asset;

  if (asset.type === 'IMAGE') {
    return (
      <img
        key={bodyItem.id}
        src={asset.url ?? undefined}
        alt={asset.name}
        crossOrigin="anonymous"
        style={{ width: '100%', height: '100%', objectFit: scaleFit(playlist, 'IMAGE'), ...mediaCropStyle(bodyItem) }}
      />
    );
  }
  if (asset.type === 'DOCUMENT' && asset.pageUrls[bodyPageIndex]) {
    return (
      <img
        key={`${bodyItem.id}-${bodyPageIndex}`}
        src={asset.pageUrls[bodyPageIndex]}
        alt={asset.name}
        crossOrigin="anonymous"
        style={{ width: '100%', height: '100%', objectFit: scaleFit(playlist, 'DOCUMENT') }}
      />
    );
  }
  if (asset.type === 'TEXT' && asset.textTickerEnabled) {
    return (
      <TextAssetTicker
        key={bodyItem.id}
        text={asset.textContent ?? ''}
        color={asset.textColor ?? '#fff'}
        backgroundColor={asset.textBackgroundColor ?? undefined}
        fontFamily={fontStack(asset.textFontFamily)}
        fontSize={FONT_SIZE_CLAMPS[asset.textSize ?? 'MEDIUM'] ?? FONT_SIZE_CLAMPS.MEDIUM!}
        direction={asset.textTickerDirection}
        speedPx={asset.textTickerSpeed ?? 80}
        crossPosition={asset.textTickerCrossOffset ?? 50}
      />
    );
  }
  if (asset.type === 'TEXT' && !asset.textTickerEnabled) {
    return (
      <div
        key={bodyItem.id}
        style={{
          width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '5%', boxSizing: 'border-box', backgroundColor: asset.textBackgroundColor ?? undefined,
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
    );
  }
  return null;
}

function ZonePlayer({ playlist, state, onAssetChange, volume = 100, forceMuted = false, controllable = false, onPlaybackProgress }: Props, ref: React.Ref<ZonePlayerHandle>) {
  const [index, setIndex] = useState(0);
  const [item, setItem] = useState<PlaylistItem | null>(null);
  // Which page of a DOCUMENT item is currently showing — durationSecs doubles as "seconds per
  // page" for this type (see hydratePlaylist on the API side).
  const [pageIndex, setPageIndex] = useState(0);
  // The just-departed item, kept mounted underneath the new `item` for a transition's duration —
  // see isLightweightTransitionable/renderLightweightAssetBody above and the advance effect below
  // for when this gets populated, and the render for how the two layers overlap.
  const [prevLayer, setPrevLayer] = useState<{ item: PlaylistItem; pageIndex: number; transition: PlaylistTransitionDefinition; durationMs: number } | null>(null);
  const [videoLoadGeneration, setVideoLoadGeneration] = useState(0);
  const [videoFailed, setVideoFailed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevLayerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pageTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // Tracks an explicit Custom Player pause across a state refetch of the same video — see the
  // autoplay effect below for why this can't just live in the `item` object itself.
  const pausedRef = useRef(false);
  const lastPlayedItemIdRef = useRef<string | null>(null);
  const videoMountedAtRef = useRef(Date.now());
  const videoLastProgressAtRef = useRef(Date.now());
  const videoLastCurrentTimeRef = useRef(0);
  const videoStartedRef = useRef(false);
  const videoRecoveryAttemptsRef = useRef(0);
  const videoRecoveryInProgressRef = useRef(false);

  // When playlist changes (publish command) reset to beginning
  useEffect(() => {
    setIndex(0);
  }, [playlist.id]);

  useEffect(() => {
    if (!playlist.items.length) return;
    const current = playlist.items[index % playlist.items.length];
    if (!current) return;

    // `item`/`pageIndex` here are still last render's values (this effect's own setItem/
    // setPageIndex below haven't run yet) — i.e. exactly the outgoing item/page, still valid to
    // read even though they're not in the dependency array (same reasoning as the eslint-disable
    // below: this effect intentionally only re-runs on index/playlist, not on every item/pageIndex
    // change, but always sees their latest committed values). A same-item re-run (playlist
    // refetched wholesale on a heartbeat, id unchanged) must not restart a transition that's
    // already mid-flight, hence the id check.
    if (item && item.id !== current.id) {
      const transition = resolveEffectiveTransition(current.transitionStyle, playlist.transitionStyle);
      const durationMs = current.transitionDurationMs ?? playlist.transitionDurationMs ?? DEFAULT_PLAYLIST_TRANSITION_DURATION_MS;
      if (transition.overlap && isLightweightTransitionable(item) && isLightweightTransitionable(current)) {
        setPrevLayer({ item, pageIndex, transition, durationMs });
        if (prevLayerTimerRef.current) clearTimeout(prevLayerTimerRef.current);
        prevLayerTimerRef.current = setTimeout(() => setPrevLayer(null), durationMs);
      } else {
        setPrevLayer(null);
      }
    }

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

    setPageIndex(0);

    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, playlist]);

  // Mount/unmount only — the advance effect above manages prevLayerTimerRef's normal
  // set/clear/reschedule lifecycle; this just guards against it firing setPrevLayer after this
  // component itself has unmounted.
  useEffect(() => {
    return () => { if (prevLayerTimerRef.current) clearTimeout(prevLayerTimerRef.current); };
  }, []);

  function advance() {
    setIndex(i => (i + 1) % playlist.items.length);
  }

  const videoIdentity = item?.kind === 'ASSET' && item.asset?.type === 'VIDEO'
    ? `${item.id}:${item.asset.url ?? ''}`
    : null;

  // Phase 9 (update_payer.md §28/29.1, constrained-hardware tier — "prepare the next local file
  // and metadata without holding a second active hardware decoder") — the visible <video> below
  // still fully unmounts and remounts on every transition, paying a cold demux/decode-to-first-
  // frame cost each time even though the source is now a local OPFS blob. A hidden, non-playing
  // sibling that has already read the next item's bytes warms the browser's local blob-read path
  // ahead of the swap, without ever running two live decoders at once (full crossfade between two
  // *visible* decoders is a separate, hardware-tiered feature this does not attempt).
  const nextVideoAsset = playlist.items.length > 1 && item
    ? (() => {
      const next = playlist.items[(index + 1) % playlist.items.length];
      if (next?.kind !== 'ASSET' || next.asset?.type !== 'VIDEO' || !next.asset.url) return null;
      // Nothing to warm if it's the same binary already mounted live (repeated-asset playlist).
      if (next.id === item.id) return null;
      return next.asset;
    })()
    : null;

  // A different item or binary URL gets a fresh recovery budget. Heartbeat/state refreshes that
  // return a new object graph but the same id+URL deliberately do not reset playback or recovery.
  useEffect(() => {
    videoMountedAtRef.current = Date.now();
    videoLastProgressAtRef.current = Date.now();
    videoLastCurrentTimeRef.current = 0;
    videoStartedRef.current = false;
    videoRecoveryAttemptsRef.current = 0;
    videoRecoveryInProgressRef.current = false;
    setVideoFailed(false);
  }, [videoIdentity]);

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

    let unlockCleanup: (() => void) | undefined;
    if (!pausedRef.current) {
      el.play().catch(() => {
        if (!el.muted) {
          el.muted = true;
          void el.play();
        }
      });
      if (!wantsMuted) {
        unlockCleanup = onAudioUnlock(() => {
          if (!videoRef.current || pausedRef.current) return;
          videoRef.current.muted = false;
          void videoRef.current.play().catch(() => undefined);
        });
      }
    }

    return () => { unlockCleanup?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, videoLoadGeneration, videoFailed]);

  // Releases a video's hardware decode session the moment we're actually done with it — either
  // the playlist moved on to a different item, or the whole player unmounted mid-video. This is
  // deliberately its own effect keyed on stable video identity/recovery generation, NOT folded
  // into the effect above that's keyed on the whole `item` object — that one legitimately re-runs on
  // every heartbeat/publish refetch (even of the same still-playing video) to re-apply live
  // muted/volume changes, but its cleanup must NOT tear down the element on those refetches.
  // It used to: `releaseVideoDecoder` lived in that effect's unconditional cleanup, so every
  // heartbeat poll (every few seconds, and it never stops) that landed while a video was
  // mid-playback ran `el.pause(); el.removeAttribute('src'); el.load()` on the still-mounted,
  // still-supposed-to-be-playing element — killing its src out from under it with nothing left
  // to ever re-set it, which is why the player kept getting stuck on a black screen instead of
  // looping. Stable identity means this fires on an actual item/source change, a deliberate local
  // recovery remount, fallback removal, or unmount — never on a same-video state refetch.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    return () => releaseVideoDecoder(el);
  }, [videoIdentity, videoLoadGeneration, videoFailed]);

  function recoverVideo(reason: 'error' | 'start-timeout' | 'no-progress') {
    if (videoRecoveryInProgressRef.current || videoFailed || item?.kind !== 'ASSET' || item.asset?.type !== 'VIDEO') return;
    videoRecoveryInProgressRef.current = true;
    const attempt = videoRecoveryAttemptsRef.current + 1;
    videoRecoveryAttemptsRef.current = attempt;
    console.warn('[lumina-video-playback]', {
      event: 'recovery',
      reason,
      itemId: item.id,
      assetId: item.asset.id,
      attempt,
      currentTime: videoRef.current?.currentTime ?? 0,
      readyState: videoRef.current?.readyState ?? 0,
    });

    if (attempt <= MAX_LOCAL_VIDEO_RECOVERIES) {
      const el = videoRef.current;
      if (el) releaseVideoDecoder(el);
      setVideoLoadGeneration(generation => generation + 1);
      return;
    }

    if (playlist.items.length > 1) {
      console.error('[lumina-video-playback]', { event: 'skip', reason, itemId: item.id, assetId: item.asset.id });
      advance();
    } else {
      console.error('[lumina-video-playback]', { event: 'fallback', reason, itemId: item.id, assetId: item.asset.id });
      setVideoFailed(true);
    }
  }

  // Media stalls normally do not throw JavaScript errors, so the global crash watchdog cannot see
  // them. Watch actual currentTime progress and bound both initial startup and mid-playback stalls.
  useEffect(() => {
    if (!videoIdentity || videoFailed) return;
    videoMountedAtRef.current = Date.now();
    videoLastProgressAtRef.current = Date.now();
    videoLastCurrentTimeRef.current = 0;
    videoStartedRef.current = false;
    videoRecoveryInProgressRef.current = false;

    const interval = setInterval(() => {
      const el = videoRef.current;
      if (!el || pausedRef.current || document.hidden || el.ended) return;
      const now = Date.now();
      if (!videoStartedRef.current) {
        if (now - videoMountedAtRef.current >= VIDEO_START_TIMEOUT_MS) recoverVideo('start-timeout');
        return;
      }
      if (!el.paused && now - videoLastProgressAtRef.current >= VIDEO_STALL_TIMEOUT_MS) recoverVideo('no-progress');
    }, VIDEO_PROGRESS_CHECK_MS);

    return () => clearInterval(interval);
    // recoverVideo intentionally uses the current render's item/playlist state. videoIdentity and
    // generation are the lifecycle boundaries that should restart this watchdog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoIdentity, videoLoadGeneration, videoFailed]);

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

  // Registry lookup, not a switch on the identifier — see resolveEffectiveTransition/
  // buildIncomingTransitionStyle (@lumina/types). An id this player build doesn't recognize
  // resolves to NONE (a plain cut) rather than throwing, so a transition added to the dashboard/
  // DB after this build ships degrades safely instead of breaking playback.
  const effectiveTransition = resolveEffectiveTransition(item.transitionStyle, playlist.transitionStyle);
  const transitionDurationMs = item.transitionDurationMs ?? playlist.transitionDurationMs ?? DEFAULT_PLAYLIST_TRANSITION_DURATION_MS;
  const incomingStyle = buildIncomingTransitionStyle(effectiveTransition, transitionDurationMs);

  return (
    <div style={{ width: '100%', height: '100%', background: '#000', position: 'relative', overflow: 'hidden' }}>
      <PlaylistTransitionStyles />

      {/* Outgoing layer — the item that was just showing, kept mounted underneath the incoming
          one for transitionDurationMs so the two can overlap (crossfade/slide/zoom/flip into each
          other). Only ever populated for IMAGE/TEXT/DOCUMENT pairs — see isLightweightTransitionable. */}
      {prevLayer && (
        <div
          key={`prev:${prevLayer.item.id}`}
          style={{ position: 'absolute', inset: 0, zIndex: 0, ...buildOutgoingTransitionStyle(prevLayer.transition, prevLayer.durationMs) }}
        >
          {renderLightweightAssetBody(playlist, prevLayer.item, prevLayer.pageIndex)}
        </div>
      )}

      {/* Incoming layer — the current item. Every kind gets its transition's "enter" animation
          (fade/slide/zoom/flip in) even when it can't overlap a live previous layer (VIDEO/THEME/
          LAYOUT/DESIGN/APP) — it just animates in solo, over the black background, instead of
          crossfading with something underneath. re-keyed on item.id so the CSS animation restarts
          on every item change instead of playing once and then sitting at its end state. */}
      <div key={`current:${item.id}`} style={{ position: 'absolute', inset: 0, zIndex: 1, ...incomingStyle }}>
      {item.kind === 'THEME' && item.theme && state && (
        <ThemeRenderer theme={item.theme} state={state} onAssetChange={onAssetChange ?? NOOP_ASSET_CHANGE} />
      )}

      {item.kind === 'DESIGN' && item.design && (
        <DesignRenderer design={item.design} />
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
              onAssetChange={onAssetChange ?? NOOP_ASSET_CHANGE}
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

      {renderLightweightAssetBody(playlist, item, pageIndex)}
      {asset?.type === 'VIDEO' && videoFailed && (
        <div
          role="status"
          style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', background: '#000' }}
        >
          Media unavailable
        </div>
      )}
      {asset?.type === 'VIDEO' && !videoFailed && (
        <video
          key={`${item.id}:${videoLoadGeneration}`}
          ref={videoRef}
          src={asset.url ?? undefined}
          autoPlay
          muted={item.muted || forceMuted}
          loop={playlist.items.length === 1}
          playsInline
          preload="auto"
          crossOrigin="anonymous"
          style={{ width: '100%', height: '100%', objectFit: scaleFit(playlist, 'VIDEO'), ...mediaCropStyle(item) }}
          onEnded={playlist.items.length === 1 ? undefined : advance}
          onPlaying={() => {
            videoStartedRef.current = true;
            videoLastProgressAtRef.current = Date.now();
            videoRecoveryInProgressRef.current = false;
            console.info('[lumina-video-playback]', { event: 'playing', itemId: item.id, assetId: asset.id, generation: videoLoadGeneration });
          }}
          onTimeUpdate={event => {
            const currentTime = event.currentTarget.currentTime;
            if (currentTime <= videoLastCurrentTimeRef.current + 0.05) return;
            videoStartedRef.current = true;
            videoLastCurrentTimeRef.current = currentTime;
            videoLastProgressAtRef.current = Date.now();
          }}
          onError={() => recoverVideo('error')}
          onStalled={() => {
            console.warn('[lumina-video-playback]', { event: 'stalled', itemId: item.id, assetId: asset.id, currentTime: videoRef.current?.currentTime ?? 0 });
          }}
        />
      )}
      </div>

      {nextVideoAsset && (
        <video
          key={`preload:${nextVideoAsset.id}:${nextVideoAsset.url}`}
          src={nextVideoAsset.url ?? undefined}
          muted
          preload="auto"
          aria-hidden="true"
          style={{ display: 'none' }}
        />
      )}
    </div>
  );
}

export default forwardRef(ZonePlayer);
