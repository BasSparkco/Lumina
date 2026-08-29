import { useEffect, useState } from 'react';
import { api, type CurrencyData } from '../lib/api';
import { cache } from '../lib/db';
import { shouldAttemptNetwork } from '../lib/connectivity';

const DISPLAY_PAIRS = ['USD', 'EUR', 'GBP', 'SAR', 'AED', 'KWD', 'QAR', 'BHD', 'OMR'];

interface Props {
  base?: string;
  currencies?: string[];
  lang?: 'en' | 'ar';
}

export default function CurrencyWidget({ base = 'USD', currencies = DISPLAY_PAIRS, lang = 'en' }: Props) {
  const [data, setData] = useState<CurrencyData | null>(null);
  const isRtl = lang === 'ar';

  useEffect(() => {
    let alive = true;
    // Same offline-cache gap as WeatherWidget — see its comment for why `prev ?? cached` matters.
    const cacheKey = `currency:${base}`;
    void cache.getWidgetData<CurrencyData>(cacheKey).then(cached => {
      if (alive && cached) setData(prev => prev ?? cached);
    });
    const load = async () => {
      if (!shouldAttemptNetwork()) return;
      try {
        const result = await api.getCurrency(base);
        if (alive) setData(result);
        void cache.saveWidgetData(cacheKey, result);
      } catch { /* keep previous */ }
    };
    void load();
    const handleOnline = () => { void load(); };
    window.addEventListener('online', handleOnline);
    const interval = setInterval(() => { void load(); }, 60 * 60 * 1000); // refresh hourly
    return () => {
      alive = false;
      window.removeEventListener('online', handleOnline);
      clearInterval(interval);
    };
  }, [base]);

  const pairs = currencies.filter(c => c !== base);

  return (
    <div
      dir={isRtl ? 'rtl' : 'ltr'}
      style={{
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
      }}
    >
      <div style={{ fontSize: 'clamp(0.7rem, 2vw, 1.2rem)', opacity: 0.6, marginBottom: '4%', textAlign: 'center', letterSpacing: '0.1em' }}>
        {isRtl ? 'أسعار الصرف' : 'EXCHANGE RATES'}
      </div>

      {!data ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.5 }}>
          {isRtl ? 'جاري التحميل…' : 'Loading…'}
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2%', overflowY: 'hidden' }}>
          {pairs.map(cur => {
            const rate = data.rates[cur];
            if (!rate) return null;
            return (
              <div
                key={cur}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '2.5% 4%',
                  background: 'rgba(255,255,255,0.06)',
                  borderRadius: '0.4em',
                  fontSize: 'clamp(0.75rem, 2vw, 1.2rem)',
                }}
              >
                <span style={{ fontWeight: 600 }}>{base} / {cur}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums', color: '#4dd' }}>
                  {rate.toFixed(cur === 'KWD' || cur === 'BHD' ? 4 : 2)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {data && (
        <div style={{ fontSize: 'clamp(0.55rem, 1.3vw, 0.8rem)', opacity: 0.35, textAlign: 'center', marginTop: '3%' }}>
          {isRtl ? 'آخر تحديث:' : 'Updated:'} {new Date(data.fetchedAt).toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}
