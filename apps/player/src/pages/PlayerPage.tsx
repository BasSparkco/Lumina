import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type Playlist, type PlayerState, type Zone } from '../lib/api';
import { cache } from '../lib/db';
import { connectSocket, disconnectSocket } from '../lib/socket';
import { resolveSchedule, msUntilNextTransition } from '../lib/scheduler';
import { usePlayerStore } from '../store/playerStore';
import ZonePlayer from '../components/ZonePlayer';
import PrayerZoneWidget, { type PrayerMethod } from '../components/PrayerZoneWidget';
import WeatherWidget from '../components/WeatherWidget';
import CurrencyWidget from '../components/CurrencyWidget';
import TickerWidget from '../components/TickerWidget';

const HEARTBEAT_INTERVAL = 30_000;
const STATE_REFRESH_INTERVAL = 60_000;

interface PlayerCommand { type: 'publish' | 'reload' | 'clear-cache' }

export default function PlayerPage() {
  const { token } = usePlayerStore();
  const navigate = useNavigate();
  const [state, setState] = useState<PlayerState | null>(null);
  const [activePlaylist, setActivePlaylist] = useState<Playlist | null>(null);
  const [loaded, setLoaded] = useState(false);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scheduleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentAssetRef = useRef<string | null>(null);

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

  // Re-evaluate schedule every minute
  const scheduleNextCheck = useCallback((s: PlayerState) => {
    if (scheduleTimerRef.current) clearTimeout(scheduleTimerRef.current);
    const delay = msUntilNextTransition(s.scheduleRules, new Date());
    scheduleTimerRef.current = setTimeout(() => {
      setActivePlaylist(resolvePlaylist(s));
      scheduleNextCheck(s);
    }, delay);
  }, [resolvePlaylist]);

  useEffect(() => {
    if (!token) { void navigate('/'); return; }

    void loadState().then(s => {
      if (s) {
        setActivePlaylist(resolvePlaylist(s));
        scheduleNextCheck(s);
      }
    });

    heartbeatRef.current = setInterval(async () => {
      try { await api.heartbeat(currentAssetRef.current); } catch { /* keep playing */ }
    }, HEARTBEAT_INTERVAL);

    refreshRef.current = setInterval(async () => {
      const s = await loadState();
      if (s) {
        setActivePlaylist(resolvePlaylist(s));
        scheduleNextCheck(s);
      }
    }, STATE_REFRESH_INTERVAL);

    const sock = connectSocket(token);
    sock.on('command', async (cmd: PlayerCommand) => {
      if (cmd.type === 'publish') {
        const s = await loadState();
        if (s) { setActivePlaylist(resolvePlaylist(s)); scheduleNextCheck(s); }
      } else if (cmd.type === 'reload') {
        window.location.reload();
      } else if (cmd.type === 'clear-cache') {
        await cache.clear();
        window.location.reload();
      }
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

  // Stopped from the dashboard — takes priority over everything else, including an
  // active emergency override, since it's an explicit "blank this screen now" action.
  if (state.stopped) return <Splash text="Playback stopped" />;

  // Emergency override — fullscreen single zone
  if (state.emergencyActive && state.emergencyPlaylist) {
    return (
      <FullscreenContainer>
        <ZonePlayer playlist={state.emergencyPlaylist} onAssetChange={id => { currentAssetRef.current = id; }} />
      </FullscreenContainer>
    );
  }

  // Multi-zone layout mode
  if (state.layout && state.layout.zones.length > 0) {
    return (
      <FullscreenContainer>
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
    <FullscreenContainer>
      <ZonePlayer
        playlist={activePlaylist}
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
        ? <ZonePlayer playlist={zone.playlist} onAssetChange={onAssetChange} />
        : null;
  }
}

function FullscreenContainer({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ width: '100vw', height: '100vh', background: '#000', position: 'relative', overflow: 'hidden' }}>
      {children}
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
