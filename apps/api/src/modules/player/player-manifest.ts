import { createHash } from 'crypto';
import { DEFAULT_FONT_ID, FONT_IDS, type PlayerManifestPriority } from '@lumina/types';

const PRIORITY_RANK: Record<PlayerManifestPriority, number> = {
  current: 0,
  next: 1,
  scheduled: 2,
  fallback: 3,
};
const FONT_ID_SET = new Set<string>(FONT_IDS);
const MEDIA_ASSET_TYPES = new Set(['IMAGE', 'VIDEO', 'AUDIO', 'TEXT', 'DOCUMENT', 'APP']);

export interface ManifestReferences {
  assetPriorities: Map<string, PlayerManifestPriority>;
  packagedFonts: string[];
  unresolvedDependencies: string[];
}

export function collectManifestReferences(desiredState: unknown): ManifestReferences {
  const assetPriorities = new Map<string, PlayerManifestPriority>();
  // Null/legacy font selections resolve to the packaged default at render time.
  const packagedFonts = new Set<string>([DEFAULT_FONT_ID]);
  const unresolved = new Set<string>();

  const addAsset = (assetId: string, priority: PlayerManifestPriority) => {
    const existing = assetPriorities.get(assetId);
    if (!existing || PRIORITY_RANK[priority] < PRIORITY_RANK[existing]) assetPriorities.set(assetId, priority);
  };

  const visit = (value: unknown, priority: PlayerManifestPriority) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item, priority);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const object = value as Record<string, unknown>;

    // Hydrated plain playlist assets keep their stable id inside the asset object rather than on
    // PlaylistItem, while Theme/Design/Wayfinding references retain explicit *AssetId fields.
    if (typeof object.id === 'string' && typeof object.type === 'string' && typeof object.mimeType === 'string'
      && MEDIA_ASSET_TYPES.has(object.type)) {
      addAsset(object.id, priority);
      if (object.type !== 'TEXT' && object.type !== 'APP' && !object.url) {
        unresolved.add(`asset:${object.id}:missing-url`);
      }
    }
    for (const key of ['assetId', 'posterAssetId', 'floorPlanAssetId', 'iconAssetId', 'thumbnailAssetId']) {
      const assetId = object[key];
      if (typeof assetId === 'string' && assetId) addAsset(assetId, priority);
    }

    for (const key of ['textFontFamily', 'fontFamily', 'headingFont', 'bodyFont']) {
      const font = object[key];
      if (typeof font === 'string' && FONT_ID_SET.has(font)) packagedFonts.add(font);
    }

    // Hydration deliberately stops at the safe nesting depth. A manifest must never pretend that
    // this truncated graph is dependency-closed, so unresolved nested references are rejected.
    if (object.kind === 'PLAYLIST' && isRecord(object.content)) {
      const playlistId = object.content.playlistId;
      if (typeof playlistId === 'string' && playlistId && !object.content.playlist) {
        unresolved.add(`playlist:${playlistId}:unresolved`);
      }
    }
    if (typeof object.kind === 'string' && ['THEME', 'LAYOUT', 'DESIGN'].includes(object.kind)) {
      const field = object.kind === 'THEME' ? 'theme' : object.kind === 'LAYOUT' ? 'layout' : 'design';
      const itemId = typeof object.id === 'string' ? object.id : 'unknown';
      if (!object[field]) unresolved.add(`playlist-item:${itemId}:${field}-unresolved`);
    }
    if (isRecord(object.content) && typeof object.content.assetId === 'string' && object.content.assetId) {
      const assetId = object.content.assetId;
      if ((object.kind === 'IMAGE' || object.kind === 'VIDEO') && !object.content.url) {
        unresolved.add(`asset:${assetId}:missing-url`);
      }
      if (object.kind === 'DOCUMENT' && (!Array.isArray(object.content.pageUrls) || object.content.pageUrls.length === 0)) {
        unresolved.add(`asset:${assetId}:missing-document-pages`);
      }
    }
    if ((object.type === 'image' || object.type === 'video') && typeof object.assetId === 'string' && object.assetId && !object.resolvedSrc) {
      unresolved.add(`asset:${object.assetId}:missing-resolved-source`);
    }

    for (const child of Object.values(object)) visit(child, priority);
  };

  // First establish complete closure at fallback priority, then promote currently relevant
  // branches. Promotion never removes dependencies collected from schedules/fallbacks.
  visit(desiredState, 'fallback');
  if (isRecord(desiredState)) {
    if (Array.isArray(desiredState.scheduleRules)) {
      for (const rule of desiredState.scheduleRules) {
        if (isRecord(rule)) visit(rule.playlist, 'scheduled');
      }
    }

    let active: unknown;
    if (desiredState.emergencyActive && desiredState.emergencyPlaylist) {
      active = desiredState.emergencyPlaylist;
    } else if (desiredState.streamingType === 'ASSET') {
      active = desiredState.asset;
    } else if (desiredState.streamingType === 'WAYFINDING') {
      active = desiredState.wayfinding;
    } else if (typeof desiredState.resolvedPlaylistId === 'string' && Array.isArray(desiredState.scheduleRules)) {
      active = desiredState.scheduleRules.find(rule => isRecord(rule) && rule.playlistId === desiredState.resolvedPlaylistId);
      if (isRecord(active)) active = active.playlist;
    } else {
      active = desiredState.defaultPlaylist;
    }
    promoteActive(active, visit);
  }

  return {
    assetPriorities,
    packagedFonts: [...packagedFonts].sort(),
    unresolvedDependencies: [...unresolved].sort(),
  };
}

function promoteActive(
  active: unknown,
  visit: (value: unknown, priority: PlayerManifestPriority) => void,
) {
  if (isRecord(active) && Array.isArray(active.items)) {
    active.items.forEach((item, index) => visit(item, index === 0 ? 'current' : index === 1 ? 'next' : 'scheduled'));
    return;
  }
  visit(active, 'current');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, canonicalize(value[key])]),
  );
}

export function manifestRevision(value: unknown): string {
  return createHash('sha256').update(canonicalStringify(value)).digest('hex');
}
