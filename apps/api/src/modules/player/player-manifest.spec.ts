import { PlayerService } from './player.service';
import { canonicalStringify, collectManifestReferences, manifestRevision } from './player-manifest';
import type { PrismaService } from '../../prisma/prisma.service';
import type { StorageService } from '../storage/storage.service';
import type { ScreenGateway } from '../ws/screen.gateway';
import type { SchedulesService } from '../schedules/schedules.service';
import type { PowerSchedulesService } from '../power-schedules/power-schedules.service';
import type { ScreensService } from '../screens/screens.service';
import type { EntitlementsService } from '../entitlements/entitlements.service';
import type { RoomPlayerStateService } from '../room-booking/room-player-state.service';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

function playlistAsset(id: string, type: 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'APP' = 'VIDEO') {
  return {
    id: `item-${id}`,
    kind: 'ASSET',
    asset: {
      id,
      name: id,
      type,
      mimeType: type === 'IMAGE' ? 'image/webp' : type === 'DOCUMENT' ? 'application/pdf' : type === 'APP' ? 'text/html' : 'video/mp4',
      url: type === 'APP' ? null : `https://media.test/${id}`,
    },
  };
}

function stateWith(items: unknown[]) {
  return {
    screenId: 'screen-1',
    streamingType: 'PLAYLIST',
    emergencyActive: false,
    emergencyPlaylist: null,
    asset: null,
    wayfinding: null,
    scheduleRules: [],
    resolvedPlaylistId: null,
    defaultPlaylist: { id: 'playlist-1', name: 'Main', items },
  };
}

function makeService(records: unknown[]) {
  const prisma = {
    asset: { findMany: jest.fn().mockResolvedValue(records) },
    screen: { findUnique: jest.fn().mockResolvedValue({ organizationId: 'org-1' }) },
  } as unknown as PrismaService;
  const storage = {
    publicUrl: jest.fn((key: string) => `https://media.test/${key}`),
  } as unknown as StorageService;
  const service = new PlayerService(
    prisma,
    storage,
    {} as ScreenGateway,
    {} as SchedulesService,
    {} as PowerSchedulesService,
    {} as ScreensService,
    {} as EntitlementsService,
    {} as RoomPlayerStateService,
  );
  return { service, prisma };
}

describe('player manifest canonicalization', () => {
  it('is stable across object key insertion order while preserving array order', () => {
    expect(canonicalStringify({ b: 2, a: { d: 4, c: 3 } }))
      .toBe(canonicalStringify({ a: { c: 3, d: 4 }, b: 2 }));
    expect(manifestRevision({ items: ['a', 'b'] })).not.toBe(manifestRevision({ items: ['b', 'a'] }));
  });

  it('collects nested media, packaged fonts, and promotes active item priorities', () => {
    const state = stateWith([
      {
        ...playlistAsset('video-current'),
        theme: {
          typography: { headingFont: 'inter', bodyFont: 'manrope' },
          elements: [{ kind: 'IMAGE', content: { assetId: 'theme-image', url: 'https://media.test/theme-image' } }],
        },
      },
      playlistAsset('video-next'),
      playlistAsset('video-later'),
    ]);

    const result = collectManifestReferences(state);

    expect(result.assetPriorities.get('video-current')).toBe('current');
    expect(result.assetPriorities.get('theme-image')).toBe('current');
    expect(result.assetPriorities.get('video-next')).toBe('next');
    expect(result.assetPriorities.get('video-later')).toBe('scheduled');
    expect(result.packagedFonts).toEqual(['inter', 'manrope']);
  });

  it('rejects a nested playlist truncated by the safe hydration depth', () => {
    const result = collectManifestReferences({
      kind: 'PLAYLIST',
      content: { playlistId: 'cyclic-playlist', playlist: null },
    });
    expect(result.unresolvedDependencies).toContain('playlist:cyclic-playlist:unresolved');
  });
});

// docs/modules/modules_shared_preflight_plan.md §8/§10 step 16 — getManifest() wraps getState(),
// so it must inherit the suspended-emergency fix without any manifest-specific code change.
// player.service.spec.ts already proves getState() itself returns the correct shape; this
// confirms the manifest/offline-caching pipeline built on top of it doesn't leak ordinary
// content back in and correctly prioritizes the one allowed emergency source for download.
describe('PlayerService.getManifest — suspended tenant with an active emergency', () => {
  function wayfindingEvacuationState() {
    return {
      screenId: 'screen-1',
      streamingType: 'WAYFINDING',
      emergencyActive: true,
      emergencyPlaylist: null,
      asset: null,
      wayfinding: {
        kiosk: { floorId: 'floor-1', x: 50, y: 50 },
        building: { id: 'building-1', name: 'Test Mall' },
        floors: [{ id: 'floor-1', level: 0, label: 'Ground', floorPlanAssetId: null, floorPlanUrl: null }],
        pois: [],
        routeNodes: [],
        routeEdges: [],
        attractPlaylist: null,
        attractTheme: null,
      },
      scheduleRules: [],
      resolvedPlaylistId: null,
      defaultPlaylist: null,
    };
  }

  it('produces a valid manifest for the evacuation-only response with no ordinary content leaking into the asset graph', async () => {
    const { service } = makeService([]);
    jest.spyOn(service, 'getState').mockResolvedValue(wayfindingEvacuationState() as never);

    const manifest = await service.getManifest('screen-1');

    expect(manifest.desiredState).toEqual(expect.objectContaining({
      emergencyActive: true,
      asset: null,
      defaultPlaylist: null,
      scheduleRules: [],
    }));
    expect((manifest.desiredState as unknown as { wayfinding: unknown }).wayfinding).not.toBeNull();
    expect(manifest.assets).toEqual([]);
    expect(manifest.networkDependencies).toEqual([]);
  });

  it('produces a valid manifest for the suspended emergency-playlist response and prioritizes its assets as current', async () => {
    const record = {
      id: 'evac-video', type: 'VIDEO', status: 'READY', appConfig: null, appProviderId: null,
      sourceUrl: null, pageCount: null,
      binaries: [{ id: 'b1', kind: 'PRIMARY', ordinal: 0, storageKey: 'evac.mp4', mimeType: 'video/mp4', sizeBytes: 10n, sha256: SHA_A }],
    };
    const { service } = makeService([record]);
    const desiredState = {
      screenId: 'screen-1',
      streamingType: 'PLAYLIST',
      emergencyActive: true,
      emergencyPlaylist: { id: 'ep1', name: 'Fire Evacuation', items: [playlistAsset('evac-video')] },
      asset: null,
      wayfinding: null,
      scheduleRules: [],
      resolvedPlaylistId: null,
      defaultPlaylist: null,
    };
    jest.spyOn(service, 'getState').mockResolvedValue(desiredState as never);

    const manifest = await service.getManifest('screen-1');

    expect(manifest.assets).toEqual([expect.objectContaining({ assetId: 'evac-video', priority: 'current' })]);
  });
});

describe('PlayerService.getManifest', () => {
  it('returns deterministic revision and binary version for identical content', async () => {
    const records = [{
      id: 'video-current',
      type: 'VIDEO',
      status: 'READY',
      appConfig: null,
      appProviderId: null,
      sourceUrl: null,
      pageCount: null,
      binaries: [{
        id: 'binary-video', kind: 'PRIMARY', ordinal: 0, storageKey: 'org/video.mp4',
        mimeType: 'video/mp4', sizeBytes: 1234n, sha256: SHA_A,
      }],
    }];
    const { service, prisma } = makeService(records);
    const desiredState = stateWith([playlistAsset('video-current')]);
    jest.spyOn(service, 'getState').mockResolvedValue(desiredState as never);

    const first = await service.getManifest('screen-1');
    const second = await service.getManifest('screen-1');

    expect(first.contentRevision).toBe(second.contentRevision);
    expect(prisma.asset.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: [{ organizationId: 'org-1' }, { organizationId: null }],
      }),
    }));
    expect(first.assets).toEqual([expect.objectContaining({
      assetId: 'video-current',
      binaryId: 'video-current:primary',
      binaryVersion: `sha256-${SHA_A}`,
      sha256: SHA_A,
      fileSize: 1234,
      priority: 'current',
    })]);
  });

  it('changes content revision for playback configuration but not binary identity for a rename', async () => {
    const record = {
      id: 'video-current', type: 'VIDEO', status: 'READY', appConfig: null, appProviderId: null,
      sourceUrl: null, pageCount: null,
      binaries: [{ id: 'b1', kind: 'PRIMARY', ordinal: 0, storageKey: 'v.mp4', mimeType: 'video/mp4', sizeBytes: 10n, sha256: SHA_A }],
    };
    const { service } = makeService([record]);
    const firstState = stateWith([{ ...playlistAsset('video-current'), durationSecs: 10 }]);
    const secondState = stateWith([{ ...playlistAsset('video-current'), durationSecs: 20 }]);
    (secondState.defaultPlaylist.items[0] as ReturnType<typeof playlistAsset>).asset.name = 'Renamed only';
    jest.spyOn(service, 'getState')
      .mockResolvedValueOnce(firstState as never)
      .mockResolvedValueOnce(secondState as never);

    const first = await service.getManifest('screen-1');
    const second = await service.getManifest('screen-1');

    expect(first.contentRevision).not.toBe(second.contentRevision);
    expect(first.assets[0]?.binaryVersion).toBe(second.assets[0]?.binaryVersion);
  });

  it('emits every verified document page as its own binary', async () => {
    const { service } = makeService([{
      id: 'document-1', type: 'DOCUMENT', status: 'READY', appConfig: null, appProviderId: null,
      sourceUrl: null, pageCount: 2,
      binaries: [
        { id: 'page-1', kind: 'DOCUMENT_PAGE', ordinal: 1, storageKey: 'p1.webp', mimeType: 'image/webp', sizeBytes: 11n, sha256: SHA_A },
        { id: 'page-2', kind: 'DOCUMENT_PAGE', ordinal: 2, storageKey: 'p2.webp', mimeType: 'image/webp', sizeBytes: 12n, sha256: SHA_B },
      ],
    }]);
    jest.spyOn(service, 'getState').mockResolvedValue(stateWith([playlistAsset('document-1', 'DOCUMENT')]) as never);

    const manifest = await service.getManifest('screen-1');

    expect(manifest.assets.map(asset => asset.binaryId)).toEqual(['document-1:page:1', 'document-1:page:2']);
    expect(manifest.assets.every(asset => asset.type === 'document-page')).toBe(true);
  });

  it('marks application assets as network-required instead of offline-ready', async () => {
    const { service } = makeService([{
      id: 'app-1', type: 'APP', status: 'READY', appProviderId: 'youtube', sourceUrl: 'https://youtube.test/watch/1',
      appConfig: { embedUrl: 'https://youtube.test/embed/1' }, pageCount: null, binaries: [],
    }]);
    jest.spyOn(service, 'getState').mockResolvedValue(stateWith([playlistAsset('app-1', 'APP')]) as never);

    const manifest = await service.getManifest('screen-1');

    expect(manifest.assets).toEqual([]);
    expect(manifest.networkDependencies).toEqual([expect.objectContaining({
      assetId: 'app-1', providerId: 'youtube', networkRequired: true,
    })]);
  });

  it('refuses to publish an atomic manifest when integrity metadata is missing', async () => {
    const { service } = makeService([{
      id: 'video-current', type: 'VIDEO', status: 'READY', appConfig: null, appProviderId: null,
      sourceUrl: null, pageCount: null, binaries: [],
    }]);
    jest.spyOn(service, 'getState').mockResolvedValue(stateWith([playlistAsset('video-current')]) as never);

    await expect(service.getManifest('screen-1')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'MANIFEST_INTEGRITY_INCOMPLETE' }),
    });
  });
});
