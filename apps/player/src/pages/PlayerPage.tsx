import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import html2canvas from 'html2canvas';
import { api, type Playlist, type PlayerState, type Zone } from '../lib/api';
import { cache } from '../lib/db';
import { connectSocket, disconnectSocket } from '../lib/socket';
import { resolveSchedule, resolvePower, msUntilNextTransition } from '../lib/scheduler';
import { usePlayerStore } from '../store/playerStore';
import ZonePlayer from '../components/ZonePlayer';
import PrayerZoneWidget, { type PrayerMethod } from '../components/PrayerZoneWidget';
import WeatherWidget from '../components/WeatherWidget';
import CurrencyWidget from '../components/CurrencyWidget';
import TickerWidget from '../components/TickerWidget';

const HEARTBEAT_INTERVAL = 30_000;
const STATE_REFRESH_INTERVAL = 60_000;

type PlayerCommand =
  | { type: 'publish' | 'reload' | 'clear-cache' | 'capture-screenshot' }
  | { type: 'unpair'; pairingCode: string };

// Whether a given zone actually has something to show, mirroring each widget's own "nothing
// configured" fallback in ZoneRenderer below (a Prayer/Weather zone with no location, or a
// Ticker with no feed URL, is exactly the kind of gap the "Awaiting content" badge exists to
// flag — it just wasn't ever being reported to the dashboard).
function zoneHasContent(zone: Zone, state: PlayerState): boolean {
  const cfg = zone.widgetConfig ?? {};
  switch (zone.zoneType) {
    case 'PRAYER':
    case 'WEATHER': {
      const lat = (cfg.latitude as number | undefined) ?? state.latitude;
      const lon = (cfg.longitude as number | undefined) ?? state.longitude;
      return lat != null && lon != null;
    }
    case 'TICKER':
      return !!cfg.feedUrl;
    case 'CURRENCY':
      return true;
    default:
      return !!zone.playlist && zone.playlist.items.length > 0;
  }
}

// Item 5 (awaiting-content badge) — the backend only flips this from the player's own
// heartbeat, so it needs an honest answer for whatever's *actually* about to render, not just
// "is a playlist assigned." Deliberately ignores poweredOn/stopped: a screen paused or outside
// its power window isn't missing content, so neither should flip the badge on.
function computeHasContent(state: PlayerState, activePlaylist: Playlist | null): boolean {
  if (state.emergencyActive && state.emergencyPlaylist) return state.emergencyPlaylist.items.length > 0;
  if (state.layout) return state.layout.zones.some(z => zoneHasContent(z, state));
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

export default function PlayerPage() {
  const { token, unpair } = usePlayerStore();
  const navigate = useNavigate();
  const [state, setState] = useState<PlayerState | null>(null);
  const [activePlaylist, setActivePlaylist] = useState<Playlist | null>(null);
  const [poweredOn, setPoweredOn] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scheduleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentAssetRef = useRef<string | null>(null);
  // Read by the heartbeat interval below, which is set up once on mount and would otherwise
  // only ever see the `activePlaylist`/`state` values from that first render.
  const hasContentRef = useRef(false);

  const loadState = useCallback(async () => {
    try {
      const fresh = await api.getState();
      await cache.saveState(fresh);
      setState(fresh);
      return fresh;
    } catch {
      const cached = await cache.getState();
      if (cached) setState(cached);
      return cached ?? null;
    } finally {
      setLoaded(true);
    }
  }, []);

  // Schedule resolution: pick the right playlist from schedule rules
  const resolvePlaylist = useCallback((s: PlayerState): Playlist | null => {
    if (s.emergencyActive && s.emergencyPlaylist) return s.emergencyPlaylist;
    if (s.layout) return null; // layout mode — zones handle their own playlists
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
      try { await api.heartbeat(currentAssetRef.current, hasContentRef.current); } catch { /* keep playing */ }
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
        await cache.clear();
        window.location.reload();
      } else if (cmd.type === 'capture-screenshot') {
        void captureAndUploadScreenshot();
      } else if (cmd.type === 'unpair') {
        await cache.clear();
        unpair(cmd.pairingCode);
        void navigate('/');
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

  if (!loaded) return <Splash text="Loading…" />;
  if (!state) return <Splash text="No content assigned" />;

  // Outside its power-on window — highest priority of all, above even an explicit stop or
  // emergency override, since it represents the physical display being off. A real off screen
  // shows nothing, so this is a bare black container with no status text (unlike Splash).
  if (!poweredOn) return <FullscreenContainer />;

  // Paused from the dashboard — takes priority over everything else, including an
  // active emergency override, since it's an explicit "blank this screen now" action.
  if (state.stopped) return <Splash text="Playback paused" />;

  // Emergency override — fullscreen single zone
  if (state.emergencyActive && state.emergencyPlaylist) {
    return (
      <FullscreenContainer showClock={state.showClock} timezone={state.timezone}>
        <ZonePlayer playlist={state.emergencyPlaylist} volume={state.volume} onAssetChange={id => { currentAssetRef.current = id; }} />
      </FullscreenContainer>
    );
  }

  // Multi-zone layout mode
  if (state.layout && state.layout.zones.length > 0) {
    return (
      <FullscreenContainer showClock={state.showClock} timezone={state.timezone}>
        {state.layout.zones.map(zone => (
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
            }}
          >
            <ZoneRenderer zone={zone} state={state} onAssetChange={id => { currentAssetRef.current = id; }} />
          </div>
        ))}
      </FullscreenContainer>
    );
  }

  // Single-playlist mode (schedule-resolved)
  if (!activePlaylist || activePlaylist.items.length === 0) {
    return <Splash text="No content scheduled right now" />;
  }

  return (
    <FullscreenContainer showClock={state.showClock} timezone={state.timezone}>
      <ZonePlayer
        playlist={activePlaylist}
        volume={state.volume}
        onAssetChange={id => { currentAssetRef.current = id; }}
      />
    </FullscreenContainer>
  );
}

function ZoneRenderer({ zone, state, onAssetChange }: { zone: Zone; state: PlayerState; onAssetChange: (id: string) => void }) {
  const cfg = zone.widgetConfig ?? {};
  const lat = (cfg.latitude as number | undefined) ?? state.latitude;
  const lon = (cfg.longitude as number | undefined) ?? state.longitude;
  const lang = (cfg.lang as 'en' | 'ar' | undefined) ?? 'en';

  switch (zone.zoneType) {
    case 'PRAYER':
      if (lat == null || lon == null) return <Splash text="Prayer zone: no location set" />;
      return (
        <PrayerZoneWidget
          latitude={lat}
          longitude={lon}
          method={((cfg.method as string | undefined) ?? state.prayerMethod) as PrayerMethod}
          athanEnabled={(cfg.athanEnabled as boolean | undefined) ?? state.athanEnabled}
          athanUrl={(cfg.athanUrl as string | undefined)}
          lang={lang}
        />
      );
    case 'WEATHER':
      if (lat == null || lon == null) return <Splash text="Weather zone: no location set" />;
      return <WeatherWidget latitude={lat} longitude={lon} lang={lang} />;
    case 'CURRENCY':
      return (
        <CurrencyWidget
          base={(cfg.base as string | undefined) ?? 'USD'}
          currencies={cfg.currencies as string[] | undefined}
          lang={lang}
        />
      );
    case 'TICKER':
      if (!cfg.feedUrl) return <Splash text="Ticker zone: no RSS URL set" />;
      return <TickerWidget feedUrl={cfg.feedUrl as string} lang={lang} />;
    default:
      return zone.playlist
        ? <ZonePlayer playlist={zone.playlist} volume={state.volume} onAssetChange={onAssetChange} />
        : null;
  }
}

function FullscreenContainer({ children, showClock, timezone }: { children?: React.ReactNode; showClock?: boolean; timezone?: string }) {
  return (
    <div style={{ width: '100vw', height: '100vh', background: '#000', position: 'relative', overflow: 'hidden' }}>
      {children}
      {showClock && timezone && <ClockOverlay timezone={timezone} />}
    </div>
  );
}

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

function Splash({ text }: { text: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#000', color: '#444', fontFamily: 'system-ui, sans-serif', fontSize: '1.25rem' }}>
      {text}
    </div>
  );
}
