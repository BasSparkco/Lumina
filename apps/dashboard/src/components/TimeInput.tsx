'use client';
import { useTimeFormat } from '@/hooks/useTimeFormat';

const selectClass = 'border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';

/** Value/onChange are always a "HH:MM" 24-hour string (or '' for unset) — only the
 * displayed controls switch between 24h and 12h based on the user's setting, since
 * native <input type="time"> pickers ignore app settings and always follow the
 * browser/OS locale instead. */
export function TimeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { format } = useTimeFormat();

  const [hStr, mStr] = value ? value.split(':') : ['', ''];
  const hour24 = hStr ? parseInt(hStr, 10) : null;
  const minute = mStr ? parseInt(mStr, 10) : null;

  function emit(h: number | null, m: number | null) {
    if (h === null || m === null) { onChange(''); return; }
    onChange(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`);
  }

  if (format === '24h') {
    return (
      <div className="flex gap-1">
        <select value={hour24 ?? ''} onChange={e => emit(e.target.value === '' ? null : Number(e.target.value), minute ?? 0)} className={selectClass}>
          <option value="">--</option>
          {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{h.toString().padStart(2, '0')}</option>)}
        </select>
        <span className="self-center text-gray-400">:</span>
        <select value={minute ?? ''} onChange={e => emit(hour24 ?? 0, e.target.value === '' ? null : Number(e.target.value))} className={selectClass}>
          <option value="">--</option>
          {Array.from({ length: 60 }, (_, m) => <option key={m} value={m}>{m.toString().padStart(2, '0')}</option>)}
        </select>
      </div>
    );
  }

  // 12h: derive displayed hour (1-12) and AM/PM from the stored 24h value
  const period = hour24 === null ? null : hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 === null ? null : hour24 % 12 || 12;

  function emit12(h12: number | null, m: number | null, p: 'AM' | 'PM' | null) {
    if (h12 === null || m === null || p === null) { onChange(''); return; }
    const h24 = p === 'AM' ? (h12 % 12) : (h12 % 12) + 12;
    emit(h24, m);
  }

  return (
    <div className="flex gap-1">
      <select value={hour12 ?? ''} onChange={e => emit12(e.target.value === '' ? null : Number(e.target.value), minute ?? 0, period ?? 'AM')} className={selectClass}>
        <option value="">--</option>
        {Array.from({ length: 12 }, (_, i) => i + 1).map(h => <option key={h} value={h}>{h}</option>)}
      </select>
      <span className="self-center text-gray-400">:</span>
      <select value={minute ?? ''} onChange={e => emit12(hour12 ?? 12, e.target.value === '' ? null : Number(e.target.value), period ?? 'AM')} className={selectClass}>
        <option value="">--</option>
        {Array.from({ length: 60 }, (_, m) => <option key={m} value={m}>{m.toString().padStart(2, '0')}</option>)}
      </select>
      <select value={period ?? 'AM'} onChange={e => emit12(hour12 ?? 12, minute ?? 0, e.target.value as 'AM' | 'PM')} className={selectClass}>
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  );
}
