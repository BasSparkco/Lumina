'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Search, Check, ChevronDown } from 'lucide-react';

// A practical spread of common IANA zones, not the full ~400-entry list.
const TIMEZONES = [
  'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Sao_Paulo', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Istanbul',
  'Africa/Cairo', 'Africa/Lagos', 'Africa/Johannesburg', 'Asia/Dubai', 'Asia/Karachi',
  'Asia/Kolkata', 'Asia/Dhaka', 'Asia/Bangkok', 'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Seoul',
  'Australia/Sydney', 'Pacific/Auckland',
];

function offsetLabel(tz: string): string {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' })
      .formatToParts(new Date())
      .find(p => p.type === 'timeZoneName');
    return (part?.value ?? '').replace('GMT', 'UTC');
  } catch {
    return '';
  }
}

interface TimezoneSelectProps {
  value: string;
  onChange: (tz: string) => void;
  disabled?: boolean;
}

export function TimezoneSelect({ value, onChange, disabled }: TimezoneSelectProps) {
  const tc = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const options = useMemo(() => TIMEZONES.map(tz => ({ tz, label: `${tz} (${offsetLabel(tz)})` })), []);
  const filtered = options.filter(o => o.label.toLowerCase().includes(query.toLowerCase()));
  const current = options.find(o => o.tz === value);

  return (
    <div className="relative" ref={ref}>
      <button type="button" disabled={disabled} onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between gap-1 border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50">
        <span className="truncate">{current?.label ?? value}</span>
        <ChevronDown className="w-3 h-3 text-gray-400 shrink-0" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg">
          <div className="p-1.5 border-b border-gray-100 dark:border-gray-700">
            <div className="relative">
              <Search className="w-3 h-3 text-gray-400 absolute top-1/2 -translate-y-1/2 start-2" />
              <input autoFocus value={query} onChange={e => setQuery(e.target.value)}
                placeholder={tc('searchTimezone')}
                className="w-full ps-6 pe-2 py-1 text-xs border border-gray-200 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500" />
            </div>
          </div>
          <div className="max-h-40 overflow-y-auto py-1">
            {filtered.length === 0 && <p className="text-xs text-gray-400 dark:text-gray-500 px-3 py-2">{tc('noMatches')}</p>}
            {filtered.map(o => (
              <button key={o.tz} type="button" onClick={() => { onChange(o.tz); setOpen(false); setQuery(''); }}
                className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-start text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
                {o.label}
                {o.tz === value && <Check className="w-3 h-3 text-indigo-600" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
