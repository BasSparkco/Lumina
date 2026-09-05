import { useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, Clock, Languages, WifiOff } from 'lucide-react';
import type { RoomBookingPlayerPayload } from '@lumina/types';
import { computeServerOffsetMs, isPayloadStale, resolveRoomDisplayState, type RoomDisplayState } from '../lib/roomBookingState';
import { RoomBookingClient } from '../lib/roomBookingClient';
import RoomBookingTimeline from './RoomBookingTimeline';
import RoomQuickBookingDialog from './RoomQuickBookingDialog';
import { getConnectivityDiagnostic, subscribeConnectivity, type ConnectivityState } from '../lib/connectivity';

const RECOMPUTE_INTERVAL_MS = 60_000;
const FRESHNESS_THRESHOLD_MS = 5 * 60_000;
const LANG_STORAGE_KEY = 'lumina-room-booking-lang';

type Lang = 'en' | 'ar';

interface RoomBookingStrings {
  available: string;
  occupied: string;
  startingSoon: string;
  outOfService: string;
  until: string;
  bookNow: string;
  offline: string;
  reconnecting: string;
  bookingFailed: string;
}

const STRINGS: Record<Lang, RoomBookingStrings> = {
  en: {
    available: 'Available', occupied: 'Occupied', startingSoon: 'Starting Soon', outOfService: 'Out of Service',
    until: 'Until', bookNow: 'Book Now', offline: 'Offline', reconnecting: 'Reconnecting…', bookingFailed: 'Booking failed — try again',
  },
  ar: {
    available: 'متاح', occupied: 'مشغول', startingSoon: 'قريبًا', outOfService: 'خارج الخدمة',
    until: 'حتى', bookNow: 'احجز الآن', offline: 'غير متصل', reconnecting: 'إعادة الاتصال…', bookingFailed: 'فشل الحجز — حاول مرة أخرى',
  },
};

const STATUS_COLOR: Record<RoomDisplayState['kind'], string> = {
  AVAILABLE: '#22c55e', STARTING_SOON: '#f59e0b', OCCUPIED: '#ef4444', OUT_OF_SERVICE: '#64748b', STALE: '#64748b',
};

function loadLang(): Lang {
  return typeof window !== 'undefined' && window.localStorage.getItem(LANG_STORAGE_KEY) === 'ar' ? 'ar' : 'en';
}

// docs/modules/room_booking_module_plan.md §4.1/§10 — the hallway display. Render order (§10.1)
// is enforced by the caller (PlayerPage): this component is only ever mounted when Room Booking
// is genuinely the highest-priority thing to show (no active emergency, valid lease, configured).
export default function RoomBookingView({ payload: serverPayload }: { payload: RoomBookingPlayerPayload }) {
  // A successful Book Now already returns the up-to-date payload — apply it immediately for
  // instant feedback rather than waiting on the 'publish' WS round trip that RoomBookingService
  // also fires (which will land moments later via a fresh `serverPayload` prop and simply
  // supersede this local overlay).
  const [localPayload, setLocalPayload] = useState<RoomBookingPlayerPayload | null>(null);
  useEffect(() => setLocalPayload(null), [serverPayload]);
  const payload = localPayload ?? serverPayload;

  const [lang, setLangRaw] = useState<Lang>(loadLang);
  const setLang = (l: Lang) => { setLangRaw(l); if (typeof window !== 'undefined') window.localStorage.setItem(LANG_STORAGE_KEY, l); };
  const s = STRINGS[lang];

  const [connectivity, setConnectivity] = useState<ConnectivityState>(() => getConnectivityDiagnostic().state);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [booking, setBooking] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const clientRef = useRef<RoomBookingClient | null>(null);
  clientRef.current ??= new RoomBookingClient();

  const offsetMs = useMemo(() => computeServerOffsetMs(payload), [payload]);
  const [now, setNow] = useState(() => new Date(Date.now() + offsetMs));

  useEffect(() => {
    setNow(new Date(Date.now() + offsetMs));
    const id = setInterval(() => setNow(new Date(Date.now() + offsetMs)), RECOMPUTE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [offsetMs]);

  useEffect(() => subscribeConnectivity(() => setConnectivity(getConnectivityDiagnostic().state)), []);

  const stale = isPayloadStale(payload, now, FRESHNESS_THRESHOLD_MS);
  const displayState: RoomDisplayState = stale
    ? { kind: 'STALE', lastGeneratedAt: payload.generatedAt }
    : resolveRoomDisplayState(now, payload.reservations, payload.display.startingSoonMinutes, payload.room.status);

  const online = connectivity === 'ONLINE';
  const canBookNow = payload.display.quickBookingEnabled && online && !stale && displayState.kind !== 'OCCUPIED' && displayState.kind !== 'OUT_OF_SERVICE';

  async function confirmBooking(durationMinutes: number) {
    setBooking(true);
    setBookingError(null);
    try {
      const result = await clientRef.current!.bookNow(durationMinutes);
      if (result.payload) setLocalPayload(result.payload);
      setDialogOpen(false);
    } catch {
      setBookingError(s.bookingFailed);
    } finally {
      setBooking(false);
    }
  }

  const statusLabel = {
    AVAILABLE: s.available, STARTING_SOON: s.startingSoon, OCCUPIED: s.occupied, OUT_OF_SERVICE: s.outOfService, STALE: s.reconnecting,
  }[displayState.kind];

  const timeFormatter = new Intl.DateTimeFormat(lang === 'ar' ? 'ar' : 'en-US', { hour: 'numeric', minute: '2-digit', timeZone: payload.room.timezone });

  return (
    <div style={styles.container} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <header style={styles.header}>
        <div>
          <div style={styles.roomName}>{payload.room.name}</div>
          {payload.room.locationLabel && <div style={styles.locationLabel}>{payload.room.locationLabel}</div>}
        </div>
        <button style={styles.langButton} onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}>
          <Languages size={18} /> {lang.toUpperCase()}
        </button>
      </header>

      <div style={{ ...styles.statusBanner, background: STATUS_COLOR[displayState.kind] }}>
        <div style={styles.statusLabel}>{statusLabel}</div>
        {displayState.kind === 'AVAILABLE' && displayState.availableUntil && (
          <div style={styles.statusDetail}>{s.until} {timeFormatter.format(new Date(displayState.availableUntil))}</div>
        )}
        {displayState.kind === 'OCCUPIED' && (
          <div style={styles.statusDetail}>{s.until} {timeFormatter.format(new Date(displayState.currentReservation.endsAt))}</div>
        )}
        {displayState.kind === 'STARTING_SOON' && (
          <div style={styles.statusDetail}>{timeFormatter.format(new Date(displayState.nextReservation.startsAt))}</div>
        )}
        {!online && (
          <div style={styles.offlineBadge}><WifiOff size={16} /> {s.offline}</div>
        )}
      </div>

      <div style={styles.body}>
        <RoomBookingTimeline reservations={payload.reservations} lang={lang} timezone={payload.room.timezone} />
        {payload.room.capacity != null && (
          <div style={styles.meta}><Calendar size={16} /> {payload.room.capacity}</div>
        )}
        <div style={styles.meta}><Clock size={16} /> {timeFormatter.format(now)}</div>
      </div>

      {bookingError && <div style={styles.errorBanner}>{bookingError}</div>}

      {canBookNow && (
        <button style={styles.bookButton} onClick={() => setDialogOpen(true)}>
          {s.bookNow}
        </button>
      )}

      {dialogOpen && (
        <RoomQuickBookingDialog
          lang={lang}
          durationsMinutes={payload.display.quickBookingDurationsMinutes}
          pending={booking}
          onConfirm={(durationMinutes) => void confirmBooking(durationMinutes)}
          onCancel={() => setDialogOpen(false)}
        />
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: '100%', height: '100%', display: 'flex', flexDirection: 'column', gap: '2vh',
    background: '#0f172a', color: '#f1f5f9', fontFamily: 'system-ui, sans-serif', padding: '3vh 3vw', boxSizing: 'border-box',
  },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  roomName: { fontSize: '2.4vw', fontWeight: 800 },
  locationLabel: { fontSize: '1.2vw', opacity: 0.6, marginTop: '0.5vh' },
  langButton: {
    display: 'flex', alignItems: 'center', gap: '0.4vw', background: 'rgba(255,255,255,0.1)',
    border: 'none', borderRadius: 999, color: '#f1f5f9', fontSize: '1vw', fontWeight: 700, padding: '0.8vh 1vw', cursor: 'pointer',
  },
  statusBanner: { borderRadius: 20, padding: '3vh 3vw', color: '#0f172a', position: 'relative' },
  statusLabel: { fontSize: '3vw', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.02em' },
  statusDetail: { fontSize: '1.4vw', fontWeight: 700, marginTop: '0.6vh', opacity: 0.85 },
  offlineBadge: {
    position: 'absolute', top: '1.5vh', insetInlineEnd: '1.5vw', display: 'flex', alignItems: 'center', gap: '0.4vw',
    background: 'rgba(15,23,42,0.7)', color: '#fff', borderRadius: 999, padding: '0.5vh 1vw', fontSize: '1vw', fontWeight: 700,
  },
  body: { flex: 1, display: 'flex', flexDirection: 'column', gap: '1.5vh', overflow: 'hidden' },
  meta: { display: 'flex', alignItems: 'center', gap: '0.6vw', fontSize: '1.1vw', opacity: 0.7 },
  errorBanner: { background: 'rgba(239,68,68,0.15)', color: '#fca5a5', borderRadius: 12, padding: '1vh 1.5vw', fontSize: '1.1vw', textAlign: 'center' },
  bookButton: {
    fontSize: '1.6vw', fontWeight: 800, color: '#0f172a', background: '#22c55e', border: 'none',
    borderRadius: 16, padding: '2.2vh 0', cursor: 'pointer',
  },
};
