import { useEffect, useRef, useState } from 'react';
import {
  Coordinates,
  CalculationMethod,
  PrayerTimes,
  Prayer,
  SunnahTimes,
} from 'adhan';

const PRAYER_NAMES_EN: Record<string, string> = {
  fajr: 'Fajr',
  sunrise: 'Sunrise',
  dhuhr: 'Dhuhr',
  asr: 'Asr',
  maghrib: 'Maghrib',
  isha: 'Isha',
};

const PRAYER_NAMES_AR: Record<string, string> = {
  fajr: 'الفجر',
  sunrise: 'الشروق',
  dhuhr: 'الظهر',
  asr: 'العصر',
  maghrib: 'المغرب',
  isha: 'العشاء',
};

export type PrayerMethod =
  | 'MuslimWorldLeague'
  | 'Egyptian'
  | 'Karachi'
  | 'UmmAlQura'
  | 'Dubai'
  | 'MoonsightingCommittee'
  | 'NorthAmerica'
  | 'Kuwait'
  | 'Qatar'
  | 'Singapore'
  | 'Tehran'
  | 'Turkey';

interface Props {
  latitude: number;
  longitude: number;
  method: PrayerMethod;
  athanEnabled?: boolean;
  athanUrl?: string;
  lang?: 'en' | 'ar';
}

interface PrayerRow {
  key: string;
  time: Date;
}

const DISPLAY_PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
const DEFAULT_ATHAN_URL = '/athan.mp3';

function computeTimes(lat: number, lon: number, method: PrayerMethod, date: Date) {
  const coords = new Coordinates(lat, lon);
  const params = CalculationMethod[method]();
  const times = new PrayerTimes(coords, date, params);
  return times;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function msUntil(target: Date): number {
  return target.getTime() - Date.now();
}

export default function PrayerZoneWidget({ latitude, longitude, method, athanEnabled = false, athanUrl = DEFAULT_ATHAN_URL, lang = 'en' }: Props) {
  const [rows, setRows] = useState<PrayerRow[]>([]);
  const [nextPrayer, setNextPrayer] = useState<{ key: string; ms: number } | null>(null);
  const [countdown, setCountdown] = useState('');
  const athanRef = useRef<HTMLAudioElement | null>(null);
  const athanFiredRef = useRef<Set<string>>(new Set());
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const names = lang === 'ar' ? PRAYER_NAMES_AR : PRAYER_NAMES_EN;
  const isRtl = lang === 'ar';

  function buildRows(date: Date): PrayerRow[] {
    const times = computeTimes(latitude, longitude, method, date);
    return DISPLAY_PRAYERS.map(key => ({
      key,
      time: times[key as keyof PrayerTimes] as Date,
    }));
  }

  function findNext(rows: PrayerRow[]): { key: string; ms: number } | null {
    const now = Date.now();
    const future = rows.filter(r => r.time.getTime() > now);
    if (!future.length || !future[0]) return null;
    return { key: future[0].key, ms: future[0].time.getTime() - now };
  }

  function formatCountdown(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
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
          if (diff < 30_000 && !athanFiredRef.current.has(dayKey)) {
            athanFiredRef.current.add(dayKey);
            if (athanRef.current) {
              athanRef.current.currentTime = 0;
              void athanRef.current.play().catch(() => {/* autoplay blocked */});
            }
          }
        }
        // Clear athan cache daily
        if (now.getHours() === 0 && now.getMinutes() === 0 && now.getSeconds() < 30) {
          athanFiredRef.current.clear();
        }
      }
    }, 1000);

    return () => { if (tickRef.current) clearInterval(tickRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latitude, longitude, method, athanEnabled]);

  const nextRow = rows.find(r => r.key === nextPrayer?.key);

  return (
    <div
      dir={isRtl ? 'rtl' : 'ltr'}
      style={{
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
      }}
    >
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: '5%' }}>
        <div style={{ fontSize: 'clamp(1rem, 3vw, 2rem)', opacity: 0.7, letterSpacing: '0.1em' }}>
          {isRtl ? 'مواقيت الصلاة' : 'PRAYER TIMES'}
        </div>
        <div style={{ fontSize: 'clamp(0.75rem, 2vw, 1.25rem)', opacity: 0.5, marginTop: '0.3em' }}>
          {new Date().toLocaleDateString(isRtl ? 'ar-SA' : 'en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </div>
      </div>

      {/* Prayer table */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '3%' }}>
        {rows.map(row => {
          const isNext = row.key === nextPrayer?.key;
          const isPassed = row.time.getTime() < Date.now();
          return (
            <div
              key={row.key}
              style={{
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
              }}
            >
              <span style={{ fontSize: 'clamp(0.8rem, 2.5vw, 1.4rem)', fontWeight: isNext ? 700 : 400 }}>
                {names[row.key] ?? row.key}
              </span>
              <span style={{ fontSize: 'clamp(0.8rem, 2.5vw, 1.4rem)', fontWeight: isNext ? 700 : 400, color: isNext ? '#D4AF37' : '#fff' }}>
                {formatTime(row.time)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Next prayer countdown */}
      {nextRow && countdown && (
        <div style={{ textAlign: 'center', marginTop: '5%', paddingTop: '4%', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
          <div style={{ fontSize: 'clamp(0.65rem, 1.8vw, 1rem)', opacity: 0.6, marginBottom: '0.3em' }}>
            {isRtl ? `${names[nextRow.key]} بعد` : `${names[nextRow.key]} in`}
          </div>
          <div style={{ fontSize: 'clamp(1.2rem, 4vw, 2.5rem)', fontWeight: 700, color: '#D4AF37', fontVariantNumeric: 'tabular-nums' }}>
            {countdown}
          </div>
        </div>
      )}

      {athanEnabled && (
        <audio ref={athanRef} src={athanUrl} preload="auto" style={{ display: 'none' }} />
      )}
    </div>
  );
}
