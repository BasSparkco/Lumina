import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
export default function WeatherWidget({ latitude, longitude, lang = 'en' }) {
    const [data, setData] = useState(null);
    const isRtl = lang === 'ar';
    useEffect(() => {
        let alive = true;
        const load = async () => {
            try {
                const result = await api.getWeather(latitude, longitude);
                if (alive)
                    setData(result);
            }
            catch { /* keep previous */ }
        };
        void load();
        const interval = setInterval(load, 10 * 60 * 1000); // refresh every 10m
        return () => { alive = false; clearInterval(interval); };
    }, [latitude, longitude]);
    if (!data) {
        return (_jsx("div", { style: containerStyle(isRtl), children: _jsx("div", { style: { opacity: 0.5, fontSize: 'clamp(0.8rem, 2vw, 1.2rem)' }, children: isRtl ? 'جاري تحميل الطقس…' : 'Loading weather…' }) }));
    }
    return (_jsxs("div", { style: containerStyle(isRtl), dir: isRtl ? 'rtl' : 'ltr', children: [_jsx("div", { style: { fontSize: 'clamp(2rem, 8vw, 5rem)', lineHeight: 1 }, children: data.icon }), _jsxs("div", { style: { fontSize: 'clamp(2rem, 7vw, 4.5rem)', fontWeight: 700, lineHeight: 1.1 }, children: [data.temperature, "\u00B0C"] }), _jsx("div", { style: { fontSize: 'clamp(0.8rem, 2.5vw, 1.5rem)', opacity: 0.85, marginTop: '0.25em' }, children: data.condition }), _jsxs("div", { style: { display: 'flex', gap: '1.5em', marginTop: '0.75em', fontSize: 'clamp(0.65rem, 1.8vw, 1rem)', opacity: 0.65 }, children: [_jsx("span", { children: isRtl ? `يشعر كـ ${data.feelsLike}°` : `Feels like ${data.feelsLike}°` }), _jsx("span", { children: isRtl ? `رطوبة ${data.humidity}%` : `Humidity ${data.humidity}%` }), _jsx("span", { children: isRtl ? `رياح ${data.windKmh} km/h` : `Wind ${data.windKmh} km/h` })] })] }));
}
function containerStyle(isRtl) {
    return {
        width: '100%',
        height: '100%',
        background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
        color: '#fff',
        fontFamily: isRtl ? "'Amiri', 'Noto Sans Arabic', sans-serif" : "'Inter', system-ui, sans-serif",
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '8%',
        boxSizing: 'border-box',
    };
}
//# sourceMappingURL=WeatherWidget.js.map