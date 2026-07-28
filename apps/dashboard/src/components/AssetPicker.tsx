'use client';
import { useQuery } from '@tanstack/react-query';
import { assetsApi } from '@/lib/api';

interface AssetPickerProps {
  value: string | null;
  onChange: (assetId: string | null) => void;
  placeholder: string;
  disabled?: boolean;
  // Restricts the list to specific asset types — defaults to image+video (the two types
  // playable standalone). Theme IMAGE/VIDEO elements pass a single-type list so an IMAGE
  // element can't be pointed at a video asset or vice versa.
  types?: ('IMAGE' | 'VIDEO')[];
}

// Reused by the screens page (screen-level ASSET streaming mode), the layouts page (zone-level
// asset media mode), and the theme editor (IMAGE/VIDEO element content) — kept
// translation-agnostic via the `placeholder` prop rather than assuming any one caller's i18n
// namespace.
export function AssetPicker({ value, onChange, placeholder, disabled, types = ['IMAGE', 'VIDEO'] }: AssetPickerProps) {
  const { data: assets = [] } = useQuery({ queryKey: ['assets'], queryFn: assetsApi.list });
  // No server-side type/status filter exists on GET /assets — filter here to only what's
  // actually playable standalone (images/videos that finished processing).
  const options = assets.filter(a => (types as string[]).includes(a.type) && a.status === 'READY');

  return (
    <select
      value={value ?? ''} disabled={disabled}
      onChange={e => onChange(e.target.value || null)}
      className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50">
      <option value="">{placeholder}</option>
      {options.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
    </select>
  );
}
