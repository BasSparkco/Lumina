import { jsx as _jsx } from "react/jsx-runtime";
import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { cache } from '../lib/db';
import { connectSocket, disconnectSocket } from '../lib/socket';
import { resolveSchedule, msUntilNextTransition } from '../lib/scheduler';
import { usePlayerStore } from '../store/playerStore';
import ZonePlayer from '../components/ZonePlayer';
import PrayerZoneWidget from '../components/PrayerZoneWidget';
import WeatherWidget from '../components/WeatherWidget';
import CurrencyWidget from '../components/CurrencyWidget';
import TickerWidget from '../components/TickerWidget';
const HEARTBEAT_INTERVAL = 30000;
const STATE_REFRESH_INTERVAL = 60000;
export default function PlayerPage() {
    const { token } = usePlayerStore();
    const navigate = useNavigate();
    const [state, setState] = useState(null);
    const [activePlaylist, setActivePlaylist] = useState(null);
    const [loaded, setLoaded] = useState(false);
    const heartbeatRef = useRef(null);
    const refreshRef = useRef(null);
    const scheduleTimerRef = useRef(null);
    const currentAssetRef = useRef(null);
    const loadState = useCallback(async () => {
        try {
            const fresh = await api.getState();
            await cache.saveState(fresh);
            setState(fresh);
            return fresh;
        }
        catch {
            const cached = await cache.getState();
            if (cached)
                setState(cached);
            return cached ?? null;
        }
        finally {
            setLoaded(true);
        }
    }, []);
    // Schedule resolution: pick the right playlist from schedule rules
    const resolvePlaylist = useCallback((s) => {
        if (s.emergencyActive && s.emergencyPlaylist)
            return s.emergencyPlaylist;
        if (s.layout)
            return null; // layout mode — zones handle their own playlists
        const matchedId = resolveSchedule(s.scheduleRules, new Date());
        if (matchedId) {
            const rule = s.scheduleRules.find(r => r.playlistId === matchedId);
            if (rule?.playlist)
                return rule.playlist;
        }
        return s.defaultPlaylist;
    }, []);
    // Re-evaluate schedule every minute
    const scheduleNextCheck = useCallback((s) => {
        if (scheduleTimerRef.current)
            clearTimeout(scheduleTimerRef.current);
        const delay = msUntilNextTransition(s.scheduleRules, new Date());
        scheduleTimerRef.current = setTimeout(() => {
            setActivePlaylist(resolvePlaylist(s));
            scheduleNextCheck(s);
        }, delay);
    }, [resolvePlaylist]);
    useEffect(() => {
        if (!token) {
            navigate('/');
            return;
        }
        void loadState().then(s => {
            if (s) {
                setActivePlaylist(resolvePlaylist(s));
                scheduleNextCheck(s);
            }
        });
        heartbeatRef.current = setInterval(async () => {
            try {
                await api.heartbeat(currentAssetRef.current);
            }
            catch { /* keep playing */ }
        }, HEARTBEAT_INTERVAL);
        refreshRef.current = setInterval(async () => {
            const s = await loadState();
            if (s) {
                setActivePlaylist(resolvePlaylist(s));
                scheduleNextCheck(s);
            }
        }, STATE_REFRESH_INTERVAL);
        const sock = connectSocket(token);
        sock.on('command', async (cmd) => {
            if (cmd.type === 'publish') {
                const s = await loadState();
                if (s) {
                    setActivePlaylist(resolvePlaylist(s));
                    scheduleNextCheck(s);
                }
            }
            else if (cmd.type === 'reload') {
                window.location.reload();
            }
            else if (cmd.type === 'clear-cache') {
                await cache.clear();
                window.location.reload();
            }
        });
        return () => {
            if (heartbeatRef.current)
                clearInterval(heartbeatRef.current);
            if (refreshRef.current)
                clearInterval(refreshRef.current);
            if (scheduleTimerRef.current)
                clearTimeout(scheduleTimerRef.current);
            disconnectSocket();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token]);
    if (!loaded)
        return _jsx(Splash, { text: "Loading\u2026" });
    if (!state)
        return _jsx(Splash, { text: "No content assigned" });
    // Emergency override — fullscreen single zone
    if (state.emergencyActive && state.emergencyPlaylist) {
        return (_jsx(FullscreenContainer, { children: _jsx(ZonePlayer, { playlist: state.emergencyPlaylist, onAssetChange: id => { currentAssetRef.current = id; } }) }));
    }
    // Multi-zone layout mode
    if (state.layout && state.layout.zones.length > 0) {
        return (_jsx(FullscreenContainer, { children: state.layout.zones.map(zone => (_jsx("div", { style: {
                    position: 'absolute',
                    left: `${zone.x}%`,
                    top: `${zone.y}%`,
                    width: `${zone.width}%`,
                    height: `${zone.height}%`,
                    zIndex: zone.zIndex,
                    overflow: 'hidden',
                }, children: _jsx(ZoneRenderer, { zone: zone, state: state, onAssetChange: id => { currentAssetRef.current = id; } }) }, zone.id))) }));
    }
    // Single-playlist mode (schedule-resolved)
    if (!activePlaylist || activePlaylist.items.length === 0) {
        return _jsx(Splash, { text: "No content scheduled right now" });
    }
    return (_jsx(FullscreenContainer, { children: _jsx(ZonePlayer, { playlist: activePlaylist, onAssetChange: id => { currentAssetRef.current = id; } }) }));
}
function ZoneRenderer({ zone, state, onAssetChange }) {
    const cfg = zone.widgetConfig ?? {};
    const lat = cfg.latitude ?? state.latitude;
    const lon = cfg.longitude ?? state.longitude;
    const lang = cfg.lang ?? 'en';
    switch (zone.zoneType) {
        case 'PRAYER':
            if (lat == null || lon == null)
                return _jsx(Splash, { text: "Prayer zone: no location set" });
            return (_jsx(PrayerZoneWidget, { latitude: lat, longitude: lon, method: (cfg.method ?? state.prayerMethod), athanEnabled: cfg.athanEnabled ?? state.athanEnabled, athanUrl: cfg.athanUrl, lang: lang }));
        case 'WEATHER':
            if (lat == null || lon == null)
                return _jsx(Splash, { text: "Weather zone: no location set" });
            return _jsx(WeatherWidget, { latitude: lat, longitude: lon, lang: lang });
        case 'CURRENCY':
            return (_jsx(CurrencyWidget, { base: cfg.base ?? 'USD', currencies: cfg.currencies, lang: lang }));
        case 'TICKER':
            if (!cfg.feedUrl)
                return _jsx(Splash, { text: "Ticker zone: no RSS URL set" });
            return _jsx(TickerWidget, { feedUrl: cfg.feedUrl, lang: lang });
        default:
            return zone.playlist
                ? _jsx(ZonePlayer, { playlist: zone.playlist, onAssetChange: onAssetChange })
                : null;
    }
}
function FullscreenContainer({ children }) {
    return (_jsx("div", { style: { width: '100vw', height: '100vh', background: '#000', position: 'relative', overflow: 'hidden' }, children: children }));
}
function Splash({ text }) {
    return (_jsx("div", { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#000', color: '#444', fontFamily: 'system-ui, sans-serif', fontSize: '1.25rem' }, children: text }));
}
//# sourceMappingURL=PlayerPage.js.map