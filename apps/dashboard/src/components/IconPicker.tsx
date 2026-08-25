'use client';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, Search, ImageOff } from 'lucide-react';
import { assetsApi } from '@/lib/api';

// The libraries offered as filter chips — Iconify prefix -> display name. Kept in sync with the
// server's ICONIFY_ALLOWED_PREFIXES allow-list (apps/api/.../assets.service.ts): search/fetch
// are rejected server-side for any prefix not in that list, so this UI never offers a choice the
// API would refuse.
const ICON_LIBRARIES: { prefix: string; label: string }[] = [
  { prefix: 'mdi', label: 'Material Design' },
  { prefix: 'ph', label: 'Phosphor' },
  { prefix: 'tabler', label: 'Tabler' },
  { prefix: 'heroicons', label: 'Heroicons' },
  { prefix: 'simple-icons', label: 'Brand logos' },
  { prefix: 'devicon', label: 'Dev tools' },
  { prefix: 'twemoji', label: 'Emoji' },
];
const ALL_PREFIXES = ICON_LIBRARIES.map(l => l.prefix);

interface IconPickerProps {
  onPick: (iconId: string, svg: string) => void;
  disabled?: boolean;
  labels: {
    searchPlaceholder: string;
    empty: string;
    importFailed: string;
    credit: string;
  };
}

// Searches across a curated set of Iconify libraries (Material Design, Phosphor, Tabler,
// Heroicons, brand logos, dev-tool logos, emoji) and, on pick, fetches that icon's sanitized SVG
// from the API and hands it to the caller — which stores it inline on the element (see the ICON
// element kind in @lumina/types) rather than as an Asset, so playback never re-fetches from
// Iconify. Search-result thumbnails are rendered directly from Iconify's CDN as plain <img>s
// (safe — a browser never executes script from an <img src>, even if the response were hostile
// SVG); only the picked icon's markup is ever sanitized and stored.
export function IconPicker({ onPick, disabled, labels }: IconPickerProps) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [activePrefixes, setActivePrefixes] = useState<Set<string>>(new Set(ALL_PREFIXES));
  const [importingId, setImportingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 400);
    return () => clearTimeout(timer);
  }, [search]);

  const prefixList = [...activePrefixes];
  const { data: icons = [], isFetching } = useQuery({
    queryKey: ['iconSearch', debouncedSearch, prefixList.join(',')],
    queryFn: () => assetsApi.searchIcons(debouncedSearch, prefixList).then(r => r.icons),
    enabled: debouncedSearch.length > 0 && prefixList.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  function toggleLibrary(prefix: string) {
    setActivePrefixes((prev) => {
      const next = new Set(prev);
      if (next.has(prefix)) next.delete(prefix);
      else next.add(prefix);
      return next.size ? next : new Set(ALL_PREFIXES);
    });
  }

  async function handlePick(iconId: string) {
    if (importingId) return;
    setError('');
    setImportingId(iconId);
    try {
      const { svg } = await assetsApi.fetchIconSvg(iconId);
      onPick(iconId, svg);
    } catch (e) {
      setError(e instanceof Error ? e.message : labels.importFailed);
    } finally {
      setImportingId(null);
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          disabled={disabled}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={labels.searchPlaceholder}
          className="w-full rounded border border-gray-200 py-1 pl-6 pr-2 text-[11px] focus:border-indigo-400 focus:outline-none disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
        />
      </div>

      <div className="flex flex-wrap gap-1">
        {ICON_LIBRARIES.map(({ prefix, label }) => (
          <button
            key={prefix}
            type="button"
            disabled={disabled}
            onClick={() => toggleLibrary(prefix)}
            className={`rounded-full border px-1.5 py-0.5 text-[9px] font-medium disabled:opacity-50 ${
              activePrefixes.has(prefix)
                ? 'border-indigo-400 bg-indigo-50 text-indigo-600 dark:border-indigo-500 dark:bg-indigo-950 dark:text-indigo-300'
                : 'border-gray-200 text-gray-500 hover:border-gray-300 dark:border-gray-700 dark:text-gray-400'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {!debouncedSearch ? null : isFetching ? (
        <div className="flex items-center justify-center gap-1.5 py-4 text-[11px] text-gray-400">
          <RefreshCw className="h-3 w-3 animate-spin" />
        </div>
      ) : !icons.length ? (
        <div className="flex flex-col items-center gap-1 py-4 text-center text-[11px] text-gray-400">
          <ImageOff className="h-4 w-4" />
          {labels.empty}
        </div>
      ) : (
        <div className="grid max-h-52 grid-cols-6 gap-1 overflow-y-auto">
          {icons.map((iconId) => (
            <button
              key={iconId}
              type="button"
              disabled={disabled || importingId !== null}
              onClick={() => void handlePick(iconId)}
              title={iconId}
              className="relative flex aspect-square items-center justify-center overflow-hidden rounded border border-gray-200 bg-gray-50 p-1.5 disabled:cursor-wait dark:border-gray-700 dark:bg-gray-800"
              style={{ opacity: importingId !== null && importingId !== iconId ? 0.5 : 1 }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary remote Iconify SVG, not a static/local image */}
              <img src={`https://api.iconify.design/${iconId}.svg`} alt="" className="h-full w-full object-contain dark:invert" />
              {importingId === iconId && (
                <span className="absolute inset-0 flex items-center justify-center bg-black/40">
                  <RefreshCw className="h-3 w-3 animate-spin text-white" />
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {error && <p className="text-[10px] text-red-500">{error}</p>}

      {!!icons.length && <p className="text-center text-[10px] text-gray-400">{labels.credit}</p>}
    </div>
  );
}
