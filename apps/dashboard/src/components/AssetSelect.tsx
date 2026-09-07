'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, X, Search, ImageIcon, Film, Music, Type, FileText, Smartphone } from 'lucide-react';
import { assetsApi } from '@/lib/api';
import type { Asset } from '@/lib/api';
import { ASSET_SORT_OPTIONS, ASSET_TYPE_LABELS, distinctAssetTypes, sortAssets, formatRelativeTime, type AssetSortKey } from '@/lib/assetSort';

const TYPE_ICON: Record<string, React.ReactNode> = {
  IMAGE: <ImageIcon className="h-3 w-3 text-blue-500" />,
  VIDEO: <Film className="h-3 w-3 text-purple-500" />,
  AUDIO: <Music className="h-3 w-3 text-green-500" />,
  TEXT: <Type className="h-3 w-3 text-amber-500" />,
  DOCUMENT: <FileText className="h-3 w-3 text-red-500" />,
  APP: <Smartphone className="h-3 w-3 text-teal-500" />,
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
          className="flex flex-1 items-center justify-between gap-1 rounded-lg border border-[var(--deck-glass-border)] bg-[var(--deck-glass-fill-strong)] px-2 py-1.5 text-left text-xs focus:outline-none focus:ring-2 focus:ring-[var(--deck-accent)] disabled:opacity-50"
        >
          <span className={`truncate ${!selected ? 'text-[var(--deck-text-low)]' : ''}`}>
            {selected ? selected.name : placeholder}
          </span>
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-[var(--deck-text-low)] transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {selected && !disabled && (
          <button
            type="button"
            onClick={() => onChange(null)}
            title="Clear"
            className="shrink-0 rounded-lg border border-[var(--deck-glass-border)] px-1.5 text-[var(--deck-text-low)] hover:text-[var(--deck-text-mid)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {open && (
        <div className="glass-popup mt-1 space-y-1.5 rounded-lg p-1.5">
          <div className="flex gap-1">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-1.5 h-3 w-3 -translate-y-1/2 text-[var(--deck-text-low)]" />
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full rounded border border-[var(--deck-glass-border)] bg-[var(--deck-glass-fill-strong)] py-1 pr-1.5 pl-5 text-[11px] focus:outline-none focus:ring-1 focus:ring-[var(--deck-accent)]"
              />
            </div>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as AssetSortKey)}
              title="Sort by"
              className="rounded border border-[var(--deck-glass-border)] bg-[var(--deck-glass-fill-strong)] px-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-[var(--deck-accent)]"
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
                    ? 'border-[var(--deck-accent)] bg-[var(--deck-accent-soft)] text-[var(--deck-accent)]'
                    : 'border-[var(--deck-glass-border)] text-[var(--deck-text-mid)] hover:bg-[var(--deck-glass-fill-strong)]'
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
                        ? 'border-[var(--deck-accent)] bg-[var(--deck-accent-soft)] text-[var(--deck-accent)]'
                        : 'border-[var(--deck-glass-border)] text-[var(--deck-text-mid)] hover:bg-[var(--deck-glass-fill-strong)]'
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
              <p className="px-1.5 py-2 text-center text-[11px] text-[var(--deck-text-low)]">{emptyLabel}</p>
            )}
            {filtered.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => pick(a)}
                className={`flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[11px] hover:bg-[var(--deck-glass-fill-strong)] ${
                  a.id === value ? 'bg-[var(--deck-accent-soft)] text-[var(--deck-accent)]' : 'text-[var(--deck-text-hi)]'
                }`}
              >
                {a.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- arbitrary remote thumbnail URL, not a static/local image
                  <img src={a.thumbnailUrl} alt="" className="h-5 w-5 shrink-0 rounded object-cover" />
                ) : (
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center">{TYPE_ICON[a.type]}</span>
                )}
                <span className="flex-1 truncate">{a.name}</span>
                <span className="shrink-0 text-[10px] text-[var(--deck-text-low)]">
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
