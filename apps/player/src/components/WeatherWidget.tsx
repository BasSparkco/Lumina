import { useEffect, useState } from 'react';
import { api, type WeatherData } from '../lib/api';
import { cache } from '../lib/db';
import { shouldAttemptNetwork } from '../lib/connectivity';

interface Props {
  latitude: number;
  longitude: number;
  lang?: 'en' | 'ar';
}

export default function WeatherWidget({ latitude, longitude, lang = 'en' }: Props) {
  const [data, setData] = useState<WeatherData | null>(null);
  const isRtl = lang === 'ar';

  useEffect(() => {
    let alive = true;
    // Unlike the layout/theme/playlist state this player already restores from IndexedDB on a
    // cold boot, this widget started from `null` every time — so a reboot while offline showed
    // "Loading weather…" forever, since there was never a successful fetch this session to fall
    // back to. `prev ?? cached` avoids the cache clobbering a fresher result if the live fetch
    // below happens to resolve first.
    const cacheKey = `weather:${latitude}:${longitude}`;
    void cache.getWidgetData<WeatherData>(cacheKey).then(cached => {
      if (alive && cached) setData(prev => prev ?? cached);
    });
    const load = async () => {
      if (!shouldAttemptNetwork()) return;
      try {
        const result = await api.getWeather(latitude, longitude);
        if (alive) setData(result);
        void cache.saveWidgetData(cacheKey, result);
      } catch { /* keep previous */ }
    };
    void load();
    const handleOnline = () => { void load(); };
    window.addEventListener('online', handleOnline);
    const interval = setInterval(() => { void load(); }, 10 * 60 * 1000); // refresh every 10m
    return () => {
      alive = false;
      window.removeEventListener('online', handleOnline);
      clearInterval(interval);
    };
  }, [latitude, longitude]);

  if (!data) {
    return (
      <div style={containerStyle(isRtl)}>
        <div style={{ opacity: 0.5, fontSize: 'clamp(0.8rem, 2vw, 1.2rem)' }}>
          {isRtl ? 'جاري تحميل الطقس…' : 'Loading weather…'}
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle(isRtl)} dir={isRtl ? 'rtl' : 'ltr'}>
      <div style={{ fontSize: 'clamp(2rem, 8vw, 5rem)', lineHeight: 1 }}>{data.icon}</div>
      <div style={{ fontSize: 'clamp(2rem, 7vw, 4.5rem)', fontWeight: 700, lineHeight: 1.1 }}>
        {data.temperature}°C
      </div>
      <div style={{ fontSize: 'clamp(0.8rem, 2.5vw, 1.5rem)', opacity: 0.85, marginTop: '0.25em' }}>
        {data.condition}
      </div>
      <div style={{ display: 'flex', gap: '1.5em', marginTop: '0.75em', fontSize: 'clamp(0.65rem, 1.8vw, 1rem)', opacity: 0.65 }}>
        <span>{isRtl ? `يشعر كـ ${data.feelsLike}°` : `Feels like ${data.feelsLike}°`}</span>
        <span>{isRtl ? `رطوبة ${data.humidity}%` : `Humidity ${data.humidity}%`}</span>
        <span>{isRtl ? `رياح ${data.windKmh} km/h` : `Wind ${data.windKmh} km/h`}</span>
      </div>
    </div>
  );
}

function containerStyle(isRtl: boolean): React.CSSProperties {
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
