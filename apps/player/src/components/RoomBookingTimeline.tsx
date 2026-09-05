import type { DisplayReservation } from '../lib/roomBookingState';

const STRINGS = {
  en: { today: "Today's schedule", free: 'Free', untitled: 'Reserved' },
  ar: { today: 'جدول اليوم', free: 'متاح', untitled: 'محجوز' },
};

// docs/modules/room_booking_module_plan.md §4.1 — "a bounded schedule timeline, normally the
// remainder of today." Privacy redaction already happened server-side (§5.2) — this component
// only ever renders whatever title/organizer the payload actually contains.
export default function RoomBookingTimeline({ reservations, lang, timezone }: {
  reservations: DisplayReservation[];
  lang: 'en' | 'ar';
  timezone: string;
}) {
  const s = STRINGS[lang];
  const formatter = new Intl.DateTimeFormat(lang === 'ar' ? 'ar' : 'en-US', { hour: 'numeric', minute: '2-digit', timeZone: timezone });

  return (
    <div style={styles.container} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <div style={styles.heading}>{s.today}</div>
      {reservations.length === 0 ? (
        <div style={styles.emptyRow}>{s.free}</div>
      ) : (
        <ul style={styles.list}>
          {reservations.map((r) => (
            <li key={r.id} style={styles.row}>
              <span style={styles.time}>{formatter.format(new Date(r.startsAt))} – {formatter.format(new Date(r.endsAt))}</span>
              <span style={styles.title}>{r.title ?? s.untitled}</span>
              {r.organizerDisplayName && <span style={styles.organizer}>{r.organizerDisplayName}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { display: 'flex', flexDirection: 'column', gap: '1vh', width: '100%' },
  heading: { fontSize: '1.1vw', fontWeight: 700, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.04em' },
  emptyRow: { fontSize: '1.2vw', opacity: 0.6, padding: '1vh 0' },
  list: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.8vh', maxHeight: '30vh', overflowY: 'auto' },
  row: {
    display: 'flex', alignItems: 'baseline', gap: '1vw', fontSize: '1.1vw',
    background: 'rgba(255,255,255,0.06)', borderRadius: 10, padding: '0.8vh 1vw',
  },
  time: { fontWeight: 700, flex: '0 0 auto', fontVariantNumeric: 'tabular-nums' },
  title: { flex: 1, opacity: 0.9 },
  organizer: { fontSize: '0.95vw', opacity: 0.6 },
};
