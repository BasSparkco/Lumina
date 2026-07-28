'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Search, Check, ChevronDown } from 'lucide-react';
import { FONT_LIBRARY, fontStack } from '@lumina/types';

const CATEGORY_ORDER = ['SANS', 'SERIF', 'DISPLAY', 'HANDWRITTEN', 'MONOSPACE', 'ARABIC'] as const;

interface FontPickerProps {
  value: string | null | undefined;
  onChange: (fontId: string) => void;
  disabled?: boolean;
}

// Searchable font picker — each option renders its own name set in its own font, so choosing a
// font is a live preview rather than a guess from a name. Shared by the text-asset editor and
// the theme editor's per-element/typography font fields; every id it can emit comes from the
// same FONT_LIBRARY (@lumina/types) the player renders with, self-hosted via @fontsource so it
// still works with no internet access on a kiosk display.
export function FontPicker({ value, onChange, disabled }: FontPickerProps) {
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

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? FONT_LIBRARY.filter(f => f.label.toLowerCase().includes(q)) : FONT_LIBRARY;
    return CATEGORY_ORDER.map(cat => ({ cat, fonts: filtered.filter(f => f.category === cat) })).filter(g => g.fonts.length);
  }, [query]);

  const current = FONT_LIBRARY.find(f => f.id === value);

  return (
    <div className="relative" ref={ref}>
      <button type="button" disabled={disabled} onClick={() => setOpen(v => !v)}
        style={{ fontFamily: current ? current.stack : undefined }}
        className="w-full flex items-center justify-between gap-1 border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50">
        <span className="truncate">{current?.label ?? value ?? '—'}</span>
        <ChevronDown className="w-3 h-3 text-gray-400 shrink-0" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg">
          <div className="p-1.5 border-b border-gray-100 dark:border-gray-700">
            <div className="relative">
              <Search className="w-3 h-3 text-gray-400 absolute top-1/2 -translate-y-1/2 start-2" />
              <input autoFocus value={query} onChange={e => setQuery(e.target.value)}
                placeholder={tc('searchFont')}
                className="w-full ps-6 pe-2 py-1 text-xs border border-gray-200 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500" />
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            {grouped.length === 0 && <p className="text-xs text-gray-400 dark:text-gray-500 px-3 py-2">{tc('noMatches')}</p>}
            {grouped.map(g => (
              <div key={g.cat}>
                <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                  {tc(`fontCategory.${g.cat}`)}
                </p>
                {g.fonts.map(f => (
                  <button key={f.id} type="button" onClick={() => { onChange(f.id); setOpen(false); setQuery(''); }}
                    style={{ fontFamily: f.stack }}
                    className="w-full flex items-center justify-between px-3 py-1.5 text-sm text-start text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
                    {f.label}
                    {f.id === value && <Check className="w-3 h-3 text-indigo-600 shrink-0" />}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export { fontStack };
