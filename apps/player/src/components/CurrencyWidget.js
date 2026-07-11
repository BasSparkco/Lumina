import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
const DISPLAY_PAIRS = ['USD', 'EUR', 'GBP', 'SAR', 'AED', 'KWD', 'QAR', 'BHD', 'OMR'];
export default function CurrencyWidget({ base = 'USD', currencies = DISPLAY_PAIRS, lang = 'en' }) {
    const [data, setData] = useState(null);
    const isRtl = lang === 'ar';
    useEffect(() => {
        let alive = true;
        const load = async () => {
            try {
                const result = await api.getCurrency(base);
                if (alive)
                    setData(result);
            }
            catch { /* keep previous */ }
        };
        void load();
        const interval = setInterval(load, 60 * 60 * 1000); // refresh hourly
        return () => { alive = false; clearInterval(interval); };
    }, [base]);
    const pairs = currencies.filter(c => c !== base);
    return (_jsxs("div", { dir: isRtl ? 'rtl' : 'ltr', style: {
            width: '100%',
            height: '100%',
            background: 'linear-gradient(135deg, #0a1628 0%, #1a2a4a 100%)',
            color: '#fff',
            fontFamily: isRtl ? "'Amiri', 'Noto Sans Arabic', sans-serif" : "'Inter', system-ui, sans-serif",
            display: 'flex',
            flexDirection: 'column',
            padding: '5%',
            boxSizing: 'border-box',
            overflow: 'hidden',
        }, children: [_jsx("div", { style: { fontSize: 'clamp(0.7rem, 2vw, 1.2rem)', opacity: 0.6, marginBottom: '4%', textAlign: 'center', letterSpacing: '0.1em' }, children: isRtl ? 'أسعار الصرف' : 'EXCHANGE RATES' }), !data ? (_jsx("div", { style: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.5 }, children: isRtl ? 'جاري التحميل…' : 'Loading…' })) : (_jsx("div", { style: { flex: 1, display: 'flex', flexDirection: 'column', gap: '2%', overflowY: 'hidden' }, children: pairs.map(cur => {
                    const rate = data.rates[cur];
                    if (!rate)
                        return null;
                    return (_jsxs("div", { style: {
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '2.5% 4%',
                            background: 'rgba(255,255,255,0.06)',
                            borderRadius: '0.4em',
                            fontSize: 'clamp(0.75rem, 2vw, 1.2rem)',
                        }, children: [_jsxs("span", { style: { fontWeight: 600 }, children: [base, " / ", cur] }), _jsx("span", { style: { fontVariantNumeric: 'tabular-nums', color: '#4dd' }, children: rate.toFixed(cur === 'KWD' || cur === 'BHD' ? 4 : 2) })] }, cur));
                }) })), data && (_jsxs("div", { style: { fontSize: 'clamp(0.55rem, 1.3vw, 0.8rem)', opacity: 0.35, textAlign: 'center', marginTop: '3%' }, children: [isRtl ? 'آخر تحديث:' : 'Updated:', " ", new Date(data.fetchedAt).toLocaleTimeString()] }))] }));
}
//# sourceMappingURL=CurrencyWidget.js.map