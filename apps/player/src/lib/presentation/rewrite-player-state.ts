import type { ResolvedDesignPayload } from '@lumina/design-schema';
import type {
  HydratedTheme,
  HydratedThemeElement,
  PlayerState,
  Playlist,
  PlaylistItem,
  WayfindingDirectory,
} from '../api';

export interface LocalAssetUriIndex {
  primary: ReadonlyMap<string, string>;
  pages: ReadonlyMap<string, readonly string[]>;
}

function requiredPrimary(index: LocalAssetUriIndex, assetId: string, context: string): string {
  const uri = index.primary.get(assetId);
  if (!uri) throw new Error(`${context} references unavailable local asset ${assetId}`);
  return uri;
}

function requiredPages(index: LocalAssetUriIndex, assetId: string, context: string): string[] {
  const pages = index.pages.get(assetId);
  if (!pages?.length) throw new Error(`${context} references unavailable document pages ${assetId}`);
  return [...pages];
}

function rewriteAsset(item: PlaylistItem, index: LocalAssetUriIndex): PlaylistItem['asset'] {
  const asset = item.asset;
  if (!asset) return null;
  if (asset.type === 'DOCUMENT') {
    return {
      ...asset,
      url: null,
      thumbnailUrl: null,
      pageUrls: requiredPages(index, asset.id, `Playlist item ${item.id}`),
    };
  }
  if (asset.type === 'IMAGE' || asset.type === 'VIDEO' || asset.type === 'AUDIO') {
    return {
      ...asset,
      url: requiredPrimary(index, asset.id, `Playlist item ${item.id}`),
      thumbnailUrl: null,
    };
  }
  // TEXT is packaged state and APP is an explicit network dependency, not local media.
  return { ...asset };
}

function rewriteThemeElement(element: HydratedThemeElement, index: LocalAssetUriIndex): HydratedThemeElement {
  if (element.kind === 'IMAGE' || element.kind === 'VIDEO') {
    return {
      ...element,
      content: {
        ...element.content,
        url: element.content.assetId
          ? requiredPrimary(index, element.content.assetId, `Theme element ${element.id}`)
          : null,
      },
    };
  }
  if (element.kind === 'DOCUMENT') {
    return {
      ...element,
      content: {
        ...element.content,
        pageUrls: element.content.assetId
          ? requiredPages(index, element.content.assetId, `Theme element ${element.id}`)
          : [],
      },
    };
  }
  if (element.kind === 'PLAYLIST') {
    return {
      ...element,
      content: {
        ...element.content,
        playlist: element.content.playlist ? rewritePlaylist(element.content.playlist, index) : null,
      },
    };
  }
  return { ...element };
}

function rewriteTheme(theme: HydratedTheme, index: LocalAssetUriIndex): HydratedTheme {
  return { ...theme, elements: theme.elements.map(element => rewriteThemeElement(element, index)) };
}

function rewriteDesign(design: ResolvedDesignPayload, index: LocalAssetUriIndex): ResolvedDesignPayload {
  return {
    ...design,
    scenes: design.scenes.map(scene => ({
      ...scene,
      background: scene.background.type === 'color'
        ? { ...scene.background }
        : {
          ...scene.background,
          resolvedSrc: scene.background.assetId
            ? requiredPrimary(index, scene.background.assetId, `Design scene ${scene.id}`)
            : undefined,
        },
      elements: scene.elements.map(element => {
        if (element.type === 'image') {
          return {
            ...element,
            resolvedSrc: element.assetId
              ? requiredPrimary(index, element.assetId, `Design element ${element.id}`)
              : undefined,
          };
        }
        if (element.type === 'video') {
          return {
            ...element,
            resolvedSrc: element.assetId
              ? requiredPrimary(index, element.assetId, `Design element ${element.id}`)
              : undefined,
            posterResolvedSrc: element.posterAssetId
              ? requiredPrimary(index, element.posterAssetId, `Design poster ${element.id}`)
              : undefined,
          };
        }
        return { ...element };
      }),
    })),
  };
}

function rewritePlaylistItem(item: PlaylistItem, index: LocalAssetUriIndex): PlaylistItem {
  return {
    ...item,
    asset: rewriteAsset(item, index),
    theme: item.theme ? rewriteTheme(item.theme, index) : null,
    layout: item.layout
      ? {
        ...item.layout,
        zones: item.layout.zones.map(zone => ({
          ...zone,
          playlist: zone.playlist ? rewritePlaylist(zone.playlist, index) : null,
        })),
      }
      : null,
    design: item.design ? rewriteDesign(item.design, index) : null,
  };
}

function rewritePlaylist(playlist: Playlist, index: LocalAssetUriIndex): Playlist {
  return { ...playlist, items: playlist.items.map(item => rewritePlaylistItem(item, index)) };
}

function rewriteWayfinding(directory: WayfindingDirectory, index: LocalAssetUriIndex): WayfindingDirectory {
  return {
    ...directory,
    floors: directory.floors.map(floor => ({
      ...floor,
      floorPlanUrl: floor.floorPlanAssetId
        ? requiredPrimary(index, floor.floorPlanAssetId, `Wayfinding floor ${floor.id}`)
        : null,
    })),
    pois: directory.pois.map(poi => ({
      ...poi,
      iconUrl: poi.iconAssetId
        ? requiredPrimary(index, poi.iconAssetId, `Wayfinding POI ${poi.id}`)
        : null,
    })),
    attractPlaylist: directory.attractPlaylist ? rewritePlaylist(directory.attractPlaylist, index) : null,
    attractTheme: directory.attractTheme ? rewriteTheme(directory.attractTheme, index) : null,
  };
}

function assertNoRemoteAssetUrls(value: unknown, remoteUrls: ReadonlySet<string>, path = 'state'): void {
  if (typeof value === 'string') {
    if (remoteUrls.has(value)) throw new Error(`Candidate retained a remote media URL at ${path}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertNoRemoteAssetUrls(child, remoteUrls, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assertNoRemoteAssetUrls(child, remoteUrls, `${path}.${key}`);
  }
}

export function rewritePlayerStateToLocalUris(
  state: PlayerState,
  index: LocalAssetUriIndex,
  remoteUrls: ReadonlySet<string>,
): PlayerState {
  const rewritten: PlayerState = {
    ...state,
    emergencyPlaylist: state.emergencyPlaylist ? rewritePlaylist(state.emergencyPlaylist, index) : null,
    asset: state.asset ? rewritePlaylist(state.asset, index) : null,
    wayfinding: state.wayfinding ? rewriteWayfinding(state.wayfinding, index) : null,
    scheduleRules: state.scheduleRules.map(rule => ({
      ...rule,
      playlist: rule.playlist ? rewritePlaylist(rule.playlist, index) : null,
    })),
    defaultPlaylist: state.defaultPlaylist ? rewritePlaylist(state.defaultPlaylist, index) : null,
    powerScheduleRules: state.powerScheduleRules.map(rule => ({ ...rule })),
  };
  assertNoRemoteAssetUrls(rewritten, remoteUrls);
  return rewritten;
}
