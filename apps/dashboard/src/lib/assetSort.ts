import type { Asset } from '@/lib/api';

export const ASSET_TYPE_LABELS: Record<Asset['type'], string> = {
  IMAGE: 'Image',
  VIDEO: 'Video',
  AUDIO: 'Audio',
  TEXT: 'Text',
  DOCUMENT: 'Document',
};

/** Distinct asset types present, in the fixed order above rather than first-seen order — so the
 * filter chips don't reshuffle as the underlying list resorts. */
export function distinctAssetTypes(assets: Asset[]): Asset['type'][] {
  const present = new Set(assets.map((a) => a.type));
  return (Object.keys(ASSET_TYPE_LABELS) as Asset['type'][]).filter((t) => present.has(t));
}

export type AssetSortKey = 'recentlyAdded' | 'recentlyUsed' | 'mostUsed' | 'name';

export const ASSET_SORT_OPTIONS: { key: AssetSortKey; label: string }[] = [
  { key: 'recentlyAdded', label: 'Recently added' },
  { key: 'recentlyUsed', label: 'Recently used' },
  { key: 'mostUsed', label: 'Most used' },
  { key: 'name', label: 'Name (A–Z)' },
];

export function sortAssets(assets: Asset[], sort: AssetSortKey): Asset[] {
  const list = [...assets];
  switch (sort) {
    case 'name':
      return list.sort((a, b) => a.name.localeCompare(b.name));
    case 'mostUsed':
      return list.sort((a, b) => (b.usageCount ?? 0) - (a.usageCount ?? 0) || a.name.localeCompare(b.name));
    case 'recentlyUsed':
      // Never-used assets sort after every used one, then fall back to name so the tail isn't
      // just createdAt order in disguise.
      return list.sort((a, b) => {
        if (!a.lastUsedAt && !b.lastUsedAt) return a.name.localeCompare(b.name);
        if (!a.lastUsedAt) return 1;
        if (!b.lastUsedAt) return -1;
        return b.lastUsedAt.localeCompare(a.lastUsedAt);
      });
    case 'recentlyAdded':
    default:
      return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

export function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}
