const STRINGS = {
  en: { title: 'Book this room', minutes: (n: number) => `${n} min`, cancel: 'Cancel', confirm: 'Book Now', booking: 'Booking…' },
  ar: { title: 'احجز هذه الغرفة', minutes: (n: number) => `${n} دقيقة`, cancel: 'إلغاء', confirm: 'احجز الآن', booking: 'جارٍ الحجز…' },
};

// docs/modules/room_booking_module_plan.md §3.7/§10.4 — durations come from administrator-
// approved presets only; the screen cannot choose another room or a custom time. Large touch
// targets, color + text (never color alone), complete English/Arabic.
export default function RoomQuickBookingDialog({ lang, durationsMinutes, pending, onConfirm, onCancel }: {
  lang: 'en' | 'ar';
  durationsMinutes: number[];
  pending: boolean;
  onConfirm: (durationMinutes: number) => void;
  onCancel: () => void;
}) {
  const s = STRINGS[lang];
  return (
    <div style={styles.overlay} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <div style={styles.card}>
        <div style={styles.title}>{s.title}</div>
        <div style={styles.durations}>
          {durationsMinutes.map((m) => (
            <button key={m} style={styles.durationButton} disabled={pending} onClick={() => onConfirm(m)}>
              {s.minutes(m)}
            </button>
          ))}
        </div>
        <button style={styles.cancelButton} disabled={pending} onClick={onCancel}>
          {pending ? s.booking : s.cancel}
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: { position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 6 },
  card: {
    background: '#1e293b', borderRadius: 20, padding: '4vh 4vw', display: 'flex', flexDirection: 'column',
    alignItems: 'stretch', gap: '2vh', minWidth: '40vw', boxShadow: '0 4px 32px rgba(0,0,0,0.5)', color: '#f1f5f9',
    fontFamily: 'system-ui, sans-serif',
  },
  title: { fontSize: '1.8vw', fontWeight: 800, textAlign: 'center' },
  durations: { display: 'flex', gap: '1vw', justifyContent: 'center', flexWrap: 'wrap' },
  durationButton: {
    fontSize: '1.4vw', fontWeight: 700, color: '#0f172a', background: '#22c55e', border: 'none',
    borderRadius: 14, padding: '2vh 2vw', cursor: 'pointer', minWidth: '8vw',
  },
  cancelButton: {
    fontSize: '1.2vw', fontWeight: 600, color: '#cbd5e1', background: 'rgba(255,255,255,0.08)',
    border: 'none', borderRadius: 999, padding: '1.4vh 0', cursor: 'pointer',
  },
};
