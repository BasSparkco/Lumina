import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { Coordinates, CalculationMethod, PrayerTimes, } from 'adhan';
const PRAYER_NAMES_EN = {
    fajr: 'Fajr',
    sunrise: 'Sunrise',
    dhuhr: 'Dhuhr',
    asr: 'Asr',
    maghrib: 'Maghrib',
    isha: 'Isha',
};
const PRAYER_NAMES_AR = {
    fajr: 'الفجر',
    sunrise: 'الشروق',
    dhuhr: 'الظهر',
    asr: 'العصر',
    maghrib: 'المغرب',
    isha: 'العشاء',
};
const DISPLAY_PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
const DEFAULT_ATHAN_URL = '/athan.mp3';
function computeTimes(lat, lon, method, date) {
    const coords = new Coordinates(lat, lon);
    const params = CalculationMethod[method]();
    const times = new PrayerTimes(coords, date, params);
    return times;
}
function formatTime(date) {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}
export default function PrayerZoneWidget({ latitude, longitude, method, athanEnabled = false, athanUrl = DEFAULT_ATHAN_URL, lang = 'en' }) {
    const [rows, setRows] = useState([]);
    const [nextPrayer, setNextPrayer] = useState(null);
    const [countdown, setCountdown] = useState('');
    const athanRef = useRef(null);
    const athanFiredRef = useRef(new Set());
    const tickRef = useRef(null);
    const names = lang === 'ar' ? PRAYER_NAMES_AR : PRAYER_NAMES_EN;
    const isRtl = lang === 'ar';
    function buildRows(date) {
        const times = computeTimes(latitude, longitude, method, date);
        return DISPLAY_PRAYERS.map(key => ({
            key,
            time: times[key],
        }));
    }
    function findNext(rows) {
        const now = Date.now();
        const future = rows.filter(r => r.time.getTime() > now);
        if (!future.length || !future[0])
            return null;
        return { key: future[0].key, ms: future[0].time.getTime() - now };
    }
    function formatCountdown(ms) {
        const total = Math.max(0, Math.floor(ms / 1000));
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        if (h > 0)
            return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        return `${m}:${String(s).padStart(2, '0')}`;
    }
    useEffect(() => {
        const today = new Date();
        const initialRows = buildRows(today);
        setRows(initialRows);
        const next = findNext(initialRows);
        setNextPrayer(next);
        tickRef.current = setInterval(() => {
            const now = new Date();
            // Rebuild daily at midnight
            const newRows = buildRows(now);
            setRows(newRows);
            const nxt = findNext(newRows);
            setNextPrayer(nxt);
            setCountdown(nxt ? formatCountdown(nxt.ms) : '');
            // Athan trigger: fire if within 30s of a prayer time
            if (athanEnabled) {
                for (const row of newRows) {
                    const diff = Math.abs(now.getTime() - row.time.getTime());
                    const dayKey = `${now.toDateString()}_${row.key}`;
                    if (diff < 30000 && !athanFiredRef.current.has(dayKey)) {
                        athanFiredRef.current.add(dayKey);
                        if (athanRef.current) {
                            athanRef.current.currentTime = 0;
                            void athanRef.current.play().catch(() => { });
                        }
                    }
                }
                // Clear athan cache daily
                if (now.getHours() === 0 && now.getMinutes() === 0 && now.getSeconds() < 30) {
                    athanFiredRef.current.clear();
                }
            }
        }, 1000);
        return () => { if (tickRef.current)
            clearInterval(tickRef.current); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [latitude, longitude, method, athanEnabled]);
    const nextRow = rows.find(r => r.key === nextPrayer?.key);
    return (_jsxs("div", { dir: isRtl ? 'rtl' : 'ltr', style: {
            width: '100%',
            height: '100%',
            background: 'linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)',
            color: '#fff',
            fontFamily: isRtl ? "'Amiri', 'Noto Sans Arabic', serif" : "'Inter', system-ui, sans-serif",
            display: 'flex',
            flexDirection: 'column',
            padding: '6%',
            boxSizing: 'border-box',
            overflow: 'hidden',
        }, children: [_jsxs("div", { style: { textAlign: 'center', marginBottom: '5%' }, children: [_jsx("div", { style: { fontSize: 'clamp(1rem, 3vw, 2rem)', opacity: 0.7, letterSpacing: '0.1em' }, children: isRtl ? 'مواقيت الصلاة' : 'PRAYER TIMES' }), _jsx("div", { style: { fontSize: 'clamp(0.75rem, 2vw, 1.25rem)', opacity: 0.5, marginTop: '0.3em' }, children: new Date().toLocaleDateString(isRtl ? 'ar-SA' : 'en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) })] }), _jsx("div", { style: { flex: 1, display: 'flex', flexDirection: 'column', gap: '3%' }, children: rows.map(row => {
                    const isNext = row.key === nextPrayer?.key;
                    const isPassed = row.time.getTime() < Date.now();
                    return (_jsxs("div", { style: {
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '3% 4%',
                            borderRadius: '0.5em',
                            background: isNext
                                ? 'rgba(212, 175, 55, 0.25)'
                                : 'rgba(255,255,255,0.05)',
                            border: isNext ? '1px solid rgba(212, 175, 55, 0.6)' : '1px solid transparent',
                            opacity: isPassed && !isNext ? 0.45 : 1,
                            transition: 'background 0.3s',
                        }, children: [_jsx("span", { style: { fontSize: 'clamp(0.8rem, 2.5vw, 1.4rem)', fontWeight: isNext ? 700 : 400 }, children: names[row.key] ?? row.key }), _jsx("span", { style: { fontSize: 'clamp(0.8rem, 2.5vw, 1.4rem)', fontWeight: isNext ? 700 : 400, color: isNext ? '#D4AF37' : '#fff' }, children: formatTime(row.time) })] }, row.key));
                }) }), nextRow && countdown && (_jsxs("div", { style: { textAlign: 'center', marginTop: '5%', paddingTop: '4%', borderTop: '1px solid rgba(255,255,255,0.1)' }, children: [_jsx("div", { style: { fontSize: 'clamp(0.65rem, 1.8vw, 1rem)', opacity: 0.6, marginBottom: '0.3em' }, children: isRtl ? `${names[nextRow.key]} بعد` : `${names[nextRow.key]} in` }), _jsx("div", { style: { fontSize: 'clamp(1.2rem, 4vw, 2.5rem)', fontWeight: 700, color: '#D4AF37', fontVariantNumeric: 'tabular-nums' }, children: countdown })] })), athanEnabled && (_jsx("audio", { ref: athanRef, src: athanUrl, preload: "auto", style: { display: 'none' } }))] }));
}
//# sourceMappingURL=PrayerZoneWidget.js.map