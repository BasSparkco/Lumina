import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import html2canvas from 'html2canvas';
import { api, ApiError, type Playlist, type PlayerState } from '../lib/api';
import { cache } from '../lib/db';
import { connectSocket, disconnectSocket, getSocket } from '../lib/socket';
import { resolveSchedule, resolvePower, msUntilNextTransition } from '../lib/scheduler';
import { usePlayerStore } from '../store/playerStore';
import { useDeviceSettingsStore } from '../store/deviceSettingsStore';
import { isAudioUnlocked, onAudioUnlock } from '../lib/audioUnlock';
import ZonePlayer, { type ZonePlayerHandle } from '../components/ZonePlayer';
import WayfindingDirectoryBoard from '../components/WayfindingDirectoryBoard';
import WayfindingKioskMap from '../components/WayfindingKioskMap';
import WayfindingEvacuationView from '../components/WayfindingEvacuationView';
import Splash from '../components/Splash';
import PlayerControlPanel from '../components/PlayerControlPanel';

const HEARTBEAT_INTERVAL = 30_000;
const STATE_REFRESH_INTERVAL = 60_000;

// Mirrors apps/api/src/modules/ws/screen.gateway.ts's PlayerCommand.
type PlayerCommand =
  | { type: 'publish' | 'reload' | 'clear-cache' | 'capture-screenshot' | 'deleted' }
  | { type: 'unpair'; pairingCode: string }
  | { type: 'pause' | 'resume' }
  | { type: 'seek'; toSeconds: number }
  | { type: 'setSpeed'; rate: number };

// Item 5 (awaiting-content badge) — the backend only flips this from the player's own
// heartbeat, so it needs an honest answer for whatever's *actually* about to render, not just
// "is a playlist assigned." Deliberately ignores poweredOn/stopped: a screen paused or outside
// its power window isn't missing content, so neither should flip the badge on.
function computeHasContent(state: PlayerState, activePlaylist: Playlist | null): boolean {
  if (state.emergencyActive && state.emergencyPlaylist) return state.emergencyPlaylist.items.length > 0;
  if (state.emergencyActive && state.wayfinding) return true; // evacuation view always renders something
  if (state.wayfinding) return state.wayfinding.pois.length > 0;
  return !!activePlaylist && activePlaylist.items.length > 0;
}

// Best-effort — a failed capture (e.g. a tainted canvas from a CORS-blocked asset) shouldn't
// crash playback; the dashboard just keeps showing whatever screenshot it already had.
async function captureAndUploadScreenshot() {
  try {
    const canvas = await html2canvas(document.body, {
      backgroundColor: '#000000',
      useCORS: true,
      logging: false,
      width: window.innerWidth,
      height: window.innerHeight,
    });
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8));
    if (blob) await api.uploadScreenshot(blob);
  } catch {
    /* ignore — see comment above */
  }
}

// Evaluated once per render of a wayfinding screen, not cached — a kiosk isn't expected to
// switch between touch and non-touch hardware mid-session, but re-checking is free either way.
function isTouchCapable() {
  return typeof window !== 'undefined' && (navigator.maxTouchPoints > 0 || 'ontouchstart' in window);
}

// Offline resilience for wayfinding (Phase 7.2) — the touch kiosk lets a visitor jump to any
// floor and the directory board rotates through all of them, but the map/board only ever
// *renders* one floor's plan at a time, so every other floor's image (and every POI icon) would
// otherwise stay unfetched — and thus uncached — until a visitor happens to browse there while
// online. Firing an out-of-band `Image` load for everything up front gets it into the browser's
// HTTP cache and the service worker's `media-cache` runtime-caching rule (see vite.config.ts)
// the same way a normal `<img>` render would, without waiting on the user to visit each floor.
function prefetchWayfindingImages(wayfinding: PlayerState['wayfinding']) {
  if (!wayfinding) return;
  const urls = [
    ...wayfinding.floors.map(f => f.floorPlanUrl),
    ...wayfinding.pois.map(p => p.iconUrl),
  ].filter((url): url is string => !!url);
  for (const url of urls) {
    const img = new Image();
    img.src = url;
  }
}

export default function PlayerPage() {
  const { token, unpair, forget } = usePlayerStore();
  const autoStart = useDeviceSettingsStore(s => s.autoStart);
  const muted = useDeviceSettingsStore(s => s.muted);
  const navigate = useNavigate();
  const [state, setState] = useState<PlayerState | null>(null);
  const [activePlaylist, setActivePlaylist] = useState<Playlist | null>(null);
  const [poweredOn, setPoweredOn] = useState(true);
  const [loaded, setLoaded] = useState(false);
  // Auto-start off (device setting) — gates rendering behind a "Tap to start" screen until the
  // first interaction. Initialized from `autoStart` once and never re-read: flipping the setting
  // mid-session shouldn't un-start a session that's already playing, only change what happens on
  // the *next* boot.
  const [started, setStarted] = useState(() => autoStart);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scheduleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentAssetRef = useRef<string | null>(null);
  // Custom Player (Phase 9/10) — only meaningful while streamingType is 'ASSET' (see
  // ZonePlayer's `controllable` prop below); a ref rather than state since commands arrive
  // imperatively over the socket and shouldn't trigger a re-render.
  const zonePlayerRef = useRef<ZonePlayerHandle>(null);
  // Read by the heartbeat interval below, which is set up once on mount and would otherwise
  // only ever see the `activePlaylist`/`state` values from that first render.
  const hasContentRef = useRef(false);

  // A revoked credential — the screen row is gone (404), or it still exists but is no longer
  // paired (401: unpaired/re-paired-elsewhere while this player was offline/backgrounded and
  // missed the live `unpair`/`deleted` socket push below). Either way this is definitive, not a
  // network hiccup: there's no pairingCode to resume into since that only ever arrives over the
  // socket, so the only way back is a full re-pair — drop credentials and cached content and go
  // request a new pairing code, instead of looping stale content (or a dead token) forever.
  const handleRevoked = useCallback(async () => {
    await cache.clear();
    forget();
    void navigate('/');
  }, [forget, navigate]);

  const loadState = useCallback(async () => {
    try {
      const fresh = await api.getState();
      await cache.saveState(fresh);
      setState(fresh);
      return fresh;
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 401)) {
        await handleRevoked();
        return null;
      }
      const cached = await cache.getState();
      if (cached) setState(cached);
      return cached ?? null;
    } finally {
      setLoaded(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleRevoked]);

  // Custom Player (Phase 9/10) — forwards ZonePlayer's ~1x/second position samples to the
  // dashboard over the socket. A stable callback (not inline) so ZonePlayer's progress-reporting
  // effect isn't torn down and restarted on every PlayerPage render.
  const handlePlaybackProgress = useCallback((progress: { currentTime: number; duration: number; paused: boolean; rate: number }) => {
    getSocket()?.emit('playback-progress', progress);
  }, []);

  // Schedule resolution: pick the right playlist from schedule rules
  const resolvePlaylist = useCallback((s: PlayerState): Playlist | null => {
    if (s.emergencyActive && s.emergencyPlaylist) return s.emergencyPlaylist;
    // Asset-streaming mode: the backend already wraps the single asset as a one-item playlist
    // (see hydrateAssetAsPlaylist), so the existing single-playlist render path below handles
    // it unchanged — no separate render branch needed.
    if (s.streamingType === 'ASSET') return s.asset;
    if (s.wayfinding) return null; // wayfinding mode — directory board renders itself
    const matchedId = resolveSchedule(s.scheduleRules, new Date());
    if (matchedId) {
      const rule = s.scheduleRules.find(r => r.playlistId === matchedId);
      if (rule?.playlist) return rule.playlist;
    }
    return s.defaultPlaylist;
  }, []);

  // Applies both the resolved playlist and the resolved power-on state for a given state snapshot.
  const applyState = useCallback((s: PlayerState) => {
    const playlist = resolvePlaylist(s);
    setActivePlaylist(playlist);
    setPoweredOn(resolvePower(s.powerScheduleRules, new Date()));
    hasContentRef.current = computeHasContent(s, playlist);
    prefetchWayfindingImages(s.wayfinding);
  }, [resolvePlaylist]);

  // Re-evaluate schedule + power window every minute
  const scheduleNextCheck = useCallback((s: PlayerState) => {
    if (scheduleTimerRef.current) clearTimeout(scheduleTimerRef.current);
    const delay = msUntilNextTransition(s.scheduleRules, new Date());
    scheduleTimerRef.current = setTimeout(() => {
      applyState(s);
      scheduleNextCheck(s);
    }, delay);
  }, [applyState]);

  useEffect(() => {
    if (!token) { void navigate('/'); return; }

    void loadState().then(s => {
      if (s) {
        applyState(s);
        scheduleNextCheck(s);
      }
    });

    heartbeatRef.current = setInterval(async () => {
      try {
        await api.heartbeat(currentAssetRef.current, hasContentRef.current);
      } catch (err) {
        // Anything else (network hiccup, transient 5xx) should just keep playing on cached
        // state — only a 401 (revoked credential) needs to react, and it's the same recovery
        // as loadState()'s, since a missed unpair leaves no pairingCode to resume into either way.
        if (err instanceof ApiError && err.status === 401) await handleRevoked();
      }
    }, HEARTBEAT_INTERVAL);

    refreshRef.current = setInterval(async () => {
      const s = await loadState();
      if (s) {
        applyState(s);
        scheduleNextCheck(s);
      }
    }, STATE_REFRESH_INTERVAL);

    const sock = connectSocket(token);
    sock.on('command', async (cmd: PlayerCommand) => {
      if (cmd.type === 'publish') {
        const s = await loadState();
        if (s) { applyState(s); scheduleNextCheck(s); }
      } else if (cmd.type === 'reload') {
        window.location.reload();
      } else if (cmd.type === 'clear-cache') {
        // Previously this only cleared the app's own IndexedDB (playlist/state/config data) —
        // it never touched the service worker's Cache Storage or the registration itself, so a
        // device stuck on an old deployed bundle (stale cached JS/CSS/HTML) had no way to force
        // a truly fresh fetch; a plain Reload can leave it running the same old code indefinitely
        // if the service worker hasn't independently decided to check for an update. This is the
        // actual "hard reset": app data, every Cache Storage entry the service worker owns, and
        // the registration itself, so the next load re-registers from scratch against whatever
        // is currently deployed.
        await cache.clear();
        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map(key => caches.delete(key)));
        }
        if ('serviceWorker' in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          await Promise.all(registrations.map(registration => registration.unregister()));
        }
        window.location.reload();
      } else if (cmd.type === 'capture-screenshot') {
        void captureAndUploadScreenshot();
      } else if (cmd.type === 'unpair') {
        await cache.clear();
        unpair(cmd.pairingCode);
        void navigate('/');
      } else if (cmd.type === 'deleted') {
        await cache.clear();
        forget();
        void navigate('/');
      } else if (cmd.type === 'pause') {
        zonePlayerRef.current?.pause();
      } else if (cmd.type === 'resume') {
        zonePlayerRef.current?.resume();
      } else if (cmd.type === 'seek') {
        zonePlayerRef.current?.seek(cmd.toSeconds);
      } else if (cmd.type === 'setSpeed') {
        zonePlayerRef.current?.setSpeed(cmd.rate);
      }
    });

    // A screen that was briefly offline (wifi hiccup, tab suspended) otherwise doesn't see
    // whatever changed until the next STATE_REFRESH_INTERVAL tick (up to 60s) — `reconnect`
    // (unlike `connect`, which also fires on the very first connection) only fires after a
    // real drop, so this doesn't duplicate the loadState() call already made above.
    sock.io.on('reconnect', () => {
      void loadState().then(s => { if (s) { applyState(s); scheduleNextCheck(s); } });
    });

    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      if (refreshRef.current) clearInterval(refreshRef.current);
      if (scheduleTimerRef.current) clearTimeout(scheduleTimerRef.current);
      disconnectSocket();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (!loaded) return <FullscreenContainer><Splash text="Loading…" /></FullscreenContainer>;

  // Auto-start off (device setting, see PlayerControlPanel) — wait for a tap before rendering
  // any real content. Doubles as the audio-unlock gesture (see lib/audioUnlock.ts).
  if (!started) {
    return (
      <FullscreenContainer>
        <button onClick={() => setStarted(true)} style={startButtonStyle}>
          Tap to start
        </button>
      </FullscreenContainer>
    );
  }

  if (!state) return <FullscreenContainer><Splash text="No content assigned" /></FullscreenContainer>;

  // Outside its power-on window — highest priority of all, above even an explicit stop or
  // emergency override, since it represents the physical display being off. A real off screen
  // shows nothing, so this is a bare black container with no status text (unlike Splash). Device
  // controls are hidden too, matching a real screen that's actually off.
  if (!poweredOn) return <FullscreenContainer hideControls />;

  // Paused from the dashboard — takes priority over everything else, including an
  // active emergency override, since it's an explicit "blank this screen now" action.
  if (state.stopped) return <FullscreenContainer orientation={state.orientation} aspectRatio={state.aspectRatio}><Splash text="Playback paused" /></FullscreenContainer>;

  // Emergency override — fullscreen single zone
  if (state.emergencyActive && state.emergencyPlaylist) {
    return (
      <FullscreenContainer orientation={state.orientation} aspectRatio={state.aspectRatio} showClock={state.showClock} timezone={state.timezone}>
        <ZonePlayer playlist={state.emergencyPlaylist} state={state} volume={state.volume} forceMuted={muted} onAssetChange={id => { currentAssetRef.current = id; }} />
      </FullscreenContainer>
    );
  }

  // Fire/evacuation mode (7.4) — same Screen.emergencyActive flag as above, but a wayfinding
  // kiosk with no explicit emergency playlist chosen gets a purpose-built evacuation-route view
  // instead of just sitting on its normal directory/map (BuildingsService.setEvacuation is what
  // flips this flag for every kiosk in a building at once).
  if (state.emergencyActive && state.wayfinding) {
    return (
      <FullscreenContainer orientation={state.orientation} aspectRatio={state.aspectRatio}>
        <WayfindingEvacuationView directory={state.wayfinding} />
      </FullscreenContainer>
    );
  }

  // Wayfinding mode — a real touchscreen gets the interactive pan/zoom/tap kiosk map (Phase
  // 7.2); a cheap non-touch panel (still a real, supported deployment target per Phase 7.1)
  // falls back to the passive auto-rotating directory board. No per-screen config needed: the
  // browser's own touch-capability signal is the right source of truth here.
  if (state.wayfinding) {
    return (
      <FullscreenContainer orientation={state.orientation} aspectRatio={state.aspectRatio}>
        {isTouchCapable()
          ? <WayfindingKioskMap state={state} onAssetChange={id => { currentAssetRef.current = id; }} />
          : <WayfindingDirectoryBoard directory={state.wayfinding} />}
      </FullscreenContainer>
    );
  }

  // Single-playlist mode (schedule-resolved) — a playlist item can itself be a THEME, a LAYOUT,
  // or an APP-type asset; ZonePlayer (via ZoneRenderer for LAYOUT items) handles all of it.
  if (!activePlaylist || activePlaylist.items.length === 0) {
    return <FullscreenContainer orientation={state.orientation} aspectRatio={state.aspectRatio}><Splash text="No content scheduled right now" /></FullscreenContainer>;
  }

  return (
    <FullscreenContainer orientation={state.orientation} aspectRatio={state.aspectRatio} showClock={state.showClock} timezone={state.timezone}>
      <ZonePlayer
        ref={zonePlayerRef}
        playlist={activePlaylist}
        state={state}
        volume={state.volume}
        forceMuted={muted}
        onAssetChange={id => { currentAssetRef.current = id; }}
        controllable={state.streamingType === 'ASSET'}
        onPlaybackProgress={handlePlaybackProgress}
      />
    </FullscreenContainer>
  );
}

// "16:9"/"9:16" as [width-parts, height-parts] — kept as integer ratios (not a precomputed float)
// so the CSS below stays exact instead of accumulating floating-point rounding at the pixel edge.
const ASPECT_RATIO_PARTS: Record<'16:9' | '9:16', [number, number]> = {
  '16:9': [16, 9],
  '9:16': [9, 16],
};

// Letterboxes/pillarboxes content to the screen's *intended* aspect ratio (Screen.aspectRatio,
// dashboard Settings tab) instead of always stretching it to fill whatever the device's real
// panel happens to be — e.g. a 16:9-designed layout shown on a non-16:9 panel gets black bars
// instead of visibly distorted content. "stretch" (or no value, e.g. cached pre-upgrade state)
// opts back out and fills the box exactly like before this field existed.
// `avail` is expressed in the *pre-rotation* box's own units (vw/vh already swapped for sideways
// orientations by the caller — see FullscreenContainer below), so this only ever does simple
// same-unit arithmetic and never needs to know the real device pixel size.
function letterboxSize(aspectRatio: '16:9' | '9:16' | 'stretch' | undefined, availW: string, availH: string): React.CSSProperties {
  if (!aspectRatio || aspectRatio === 'stretch') return { width: '100%', height: '100%' };
  const [w, h] = ASPECT_RATIO_PARTS[aspectRatio];
  return {
    width: `min(${availW}, ${availH} * ${w} / ${h})`,
    height: `min(${availH}, ${availW} * ${h} / ${w})`,
  };
}

// Rotates the whole display for kiosks physically mounted sideways/upside-down. Dashboard-driven
// (Screen.orientation, see ScreensPage's Settings tab) rather than a device setting, so it can be
// set remotely without anyone standing at the screen. Centers a box sized to the *rotated*
// dimensions inside the true (unrotated) viewport so it fills the screen exactly at every angle:
// rotation happens about the box's own center, which `translate(-50%, -50%)` has already pinned
// to the viewport's center, so the two operations commute regardless of transform order.
function FullscreenContainer({ children, orientation = 0, aspectRatio, showClock, timezone, hideControls }: { children?: React.ReactNode; orientation?: 0 | 90 | 180 | 270; aspectRatio?: '16:9' | '9:16' | 'stretch'; showClock?: boolean; timezone?: string; hideControls?: boolean }) {
  const deviceMuted = useDeviceSettingsStore(s => s.muted);
  const sideways = orientation === 90 || orientation === 270;
  // Matches the swap applied to the rotate wrapper's own width/height just below — the box this
  // letterboxes into is the *pre-rotation* one, so "available width" here is 100vh, not 100vw,
  // whenever the panel is mounted sideways.
  const box = letterboxSize(aspectRatio, sideways ? '100vh' : '100vw', sideways ? '100vw' : '100vh');
  return (
    <div style={{ width: '100vw', height: '100vh', background: '#000', overflow: 'hidden', position: 'fixed', inset: 0 }}>
      <div
        style={{
          position: 'absolute', top: '50%', left: '50%',
          width: sideways ? '100vh' : '100vw',
          height: sideways ? '100vw' : '100vh',
          transform: `translate(-50%, -50%) rotate(${orientation}deg)`,
        }}
      >
        <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ ...box, background: '#000', position: 'relative', overflow: 'hidden' }}>
              {children}
            </div>
          </div>
          {showClock && timezone && <ClockOverlay timezone={timezone} />}
          {!hideControls && !deviceMuted && <SoundLockedIndicator />}
          {!hideControls && <PlayerControlPanel />}
        </div>
      </div>
    </div>
  );
}

// Chrome/Firefox refuse unmuted autoplay until the page has seen a real click/tap/keypress (see
// audioUnlock.ts) — with autoStart on (the default), that gesture may never happen on its own, so
// video/app content that's meant to have sound silently plays muted instead, with nothing on
// screen to explain why. This surfaces that state and doubles as an obvious tap target: any click
// on it (or anywhere else in the document) unlocks audio for every player already mounted.
function SoundLockedIndicator() {
  const [unlocked, setUnlocked] = useState(isAudioUnlocked);
  useEffect(() => {
    if (unlocked) return;
    return onAudioUnlock(() => setUnlocked(true));
  }, [unlocked]);
  if (unlocked) return null;
  return (
    <div
      style={{
        position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 9998,
        display: 'flex', alignItems: 'center', gap: 8, color: '#fff', background: 'rgba(0,0,0,0.55)',
        padding: '8px 16px', borderRadius: 999, fontFamily: 'system-ui, sans-serif', fontSize: '0.9rem',
        pointerEvents: 'none',
      }}
    >
      <MutedSpeakerIcon />
      Tap anywhere for sound
    </div>
  );
}

function MutedSpeakerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <line x1="23" y1="9" x2="17" y2="15" />
      <line x1="17" y1="9" x2="23" y2="15" />
    </svg>
  );
}

const startButtonStyle: React.CSSProperties = {
  position: 'absolute', inset: 0, width: '100%', height: '100%',
  background: '#000', color: '#fff', border: 'none', cursor: 'pointer',
  fontFamily: 'system-ui, sans-serif', fontSize: '1.5rem', fontWeight: 600, letterSpacing: '0.02em',
};

function ClockOverlay({ timezone }: { timezone: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: timezone });
  return (
    <div
      style={{
        position: 'absolute', top: 16, right: 16, zIndex: 9999,
        color: '#fff', background: 'rgba(0,0,0,0.55)', padding: '6px 16px', borderRadius: 8,
        fontFamily: 'system-ui, sans-serif', fontSize: '1.75rem', fontWeight: 600, letterSpacing: '0.02em',
      }}
    >
      {time}
    </div>
  );
}
