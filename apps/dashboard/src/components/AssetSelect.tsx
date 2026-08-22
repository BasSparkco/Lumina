'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, X, Search, ImageIcon, Film, Music, Type, FileText } from 'lucide-react';
import { assetsApi } from '@/lib/api';
import type { Asset } from '@/lib/api';
import { ASSET_SORT_OPTIONS, ASSET_TYPE_LABELS, distinctAssetTypes, sortAssets, formatRelativeTime, type AssetSortKey } from '@/lib/assetSort';

const TYPE_ICON: Record<string, React.ReactNode> = {
  IMAGE: <ImageIcon className="h-3 w-3 text-blue-500" />,
  VIDEO: <Film className="h-3 w-3 text-purple-500" />,
  AUDIO: <Music className="h-3 w-3 text-green-500" />,
  TEXT: <Type className="h-3 w-3 text-amber-500" />,
  DOCUMENT: <FileText className="h-3 w-3 text-red-500" />,
};

interface AssetSelectProps {
  assets: Asset[];
  value: string | null;
  onChange: (assetId: string | null) => void;
  placeholder: string;
  disabled?: boolean;
  searchPlaceholder?: string;
  emptyLabel?: string;
}

// Searchable/filterable/sortable replacement for a bare `<select>` full of every asset — used by
// both AssetPicker and ImagePicker's "existing" tab so neither editor's Add Item picker forces
// scanning an unsorted wall of names to find one asset. Renders inline (never `absolute`/`fixed`)
// so it can't get clipped by an ancestor's `overflow-y-auto` — several call sites (EditorAddSidebar's
// quick-add panels) sit inside exactly that kind of scroll container.
export function AssetSelect({
  assets, value, onChange, placeholder, disabled,
  searchPlaceholder = 'Search assets…',
  emptyLabel = 'No assets found',
}: AssetSelectProps) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<AssetSortKey>('recentlyAdded');
  // Empty = every type shown; otherwise combines (AND) with search/sort — e.g. "recently used" +
  // only IMAGE. Types are whatever's in `assets` (already narrowed by the caller's own `types`
  // prop), so this only ever offers to narrow further, never to escape that scope.
  const [typeFilter, setTypeFilter] = useState<Set<Asset['type']>>(new Set());
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = value ? assets.find((a) => a.id === value) : undefined;
  const availableTypes = useMemo(() => distinctAssetTypes(assets), [assets]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let base = q ? assets.filter((a) => a.name.toLowerCase().includes(q)) : assets;
    if (typeFilter.size > 0) base = base.filter((a) => typeFilter.has(a.type));
    return sortAssets(base, sort);
  }, [assets, search, sort, typeFilter]);

  function toggleType(t: Asset['type']) {
    setTypeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      // Every type checked individually is equivalent to none checked (no restriction) — collapse
      // back to the empty-set "all" state so the chip row doesn't show every chip active forever.
      return next.size === availableTypes.length ? new Set() : next;
    });
  }

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    function handleClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  function pick(asset: Asset) {
    onChange(asset.id);
    // Fire-and-forget: a failed touch just means this pick doesn't move the "recently used"
    // needle, not worth surfacing as an error to the person placing an asset.
    void assetsApi.touch(asset.id).then(() => qc.invalidateQueries({ queryKey: ['assets'] })).catch(() => {});
    setOpen(false);
    setSearch('');
  }

  return (
    <div ref={rootRef} className="relative">
      <div className="flex items-stretch gap-1">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((o) => !o)}
          className="flex flex-1 items-center justify-between gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-left text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
        >
          <span className={`truncate ${!selected ? 'text-gray-400 dark:text-gray-500' : ''}`}>
            {selected ? selected.name : placeholder}
          </span>
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {selected && !disabled && (
          <button
            type="button"
            onClick={() => onChange(null)}
            title="Clear"
            className="shrink-0 rounded-lg border border-gray-200 px-1.5 text-gray-400 hover:text-gray-600 dark:border-gray-700 dark:hover:text-gray-200"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {open && (
        <div className="mt-1 space-y-1.5 rounded-lg border border-gray-200 bg-white p-1.5 dark:border-gray-700 dark:bg-gray-800">
          <div className="flex gap-1">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-1.5 h-3 w-3 -translate-y-1/2 text-gray-400" />
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full rounded border border-gray-200 bg-white py-1 pr-1.5 pl-5 text-[11px] focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              />
            </div>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as AssetSortKey)}
              title="Sort by"
              className="rounded border border-gray-200 bg-white px-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            >
              {ASSET_SORT_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
          </div>

          {availableTypes.length > 1 && (
            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                onClick={() => setTypeFilter(new Set())}
                className={`rounded-full border px-1.5 py-0.5 text-[10px] ${
                  typeFilter.size === 0
                    ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
                    : 'border-gray-200 text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-700'
                }`}
              >
                All
              </button>
              {availableTypes.map((t) => {
                const active = typeFilter.size === 0 || typeFilter.has(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleType(t)}
                    className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] ${
                      active
                        ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
                        : 'border-gray-200 text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-700'
                    }`}
                  >
                    {TYPE_ICON[t]} {ASSET_TYPE_LABELS[t]}
                  </button>
                );
              })}
            </div>
          )}

          <div className="max-h-48 space-y-0.5 overflow-y-auto">
            {filtered.length === 0 && (
              <p className="px-1.5 py-2 text-center text-[11px] text-gray-400 dark:text-gray-500">{emptyLabel}</p>
            )}
            {filtered.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => pick(a)}
                className={`flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[11px] hover:bg-gray-100 dark:hover:bg-gray-700 ${
                  a.id === value ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300' : 'text-gray-700 dark:text-gray-200'
                }`}
              >
                {a.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- arbitrary remote thumbnail URL, not a static/local image
                  <img src={a.thumbnailUrl} alt="" className="h-5 w-5 shrink-0 rounded object-cover" />
                ) : (
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center">{TYPE_ICON[a.type]}</span>
                )}
                <span className="flex-1 truncate">{a.name}</span>
                <span className="shrink-0 text-[10px] text-gray-400 dark:text-gray-500">
                  {sort === 'mostUsed'
                    ? `${a.usageCount ?? 0}×`
                    : sort === 'recentlyUsed'
                      ? (a.lastUsedAt ? formatRelativeTime(a.lastUsedAt) : '—')
                      : sort === 'recentlyAdded'
                        ? formatRelativeTime(a.createdAt)
                        : ''}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
