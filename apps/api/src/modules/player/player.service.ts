import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ScreenGateway } from '../ws/screen.gateway';
import { SchedulesService } from '../schedules/schedules.service';

@Injectable()
export class PlayerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly gateway: ScreenGateway,
    private readonly schedules: SchedulesService,
  ) {}

  async requestPairingCode(): Promise<{ pairingCode: string; screenId: string }> {
    let code: string;
    let attempts = 0;
    do {
      code = Math.random().toString(36).substring(2, 8).toUpperCase();
      attempts++;
    } while (attempts < 10 && (await this.prisma.screen.findUnique({ where: { pairingCode: code } })));

    const screen = await this.prisma.screen.create({
      data: { name: 'Unnamed Screen', pairingCode: code, paired: false },
    });

    return { pairingCode: code, screenId: screen.id };
  }

  async checkPairingById(screenId: string): Promise<{ paired: false } | { paired: true; token: string }> {
    const screen = await this.prisma.screen.findUnique({ where: { id: screenId } });
    if (!screen) return { paired: false };
    if (screen.paired && screen.playerToken) return { paired: true, token: screen.playerToken };
    return { paired: false };
  }

  /** Legacy single-playlist endpoint — kept for backwards compat */
  async getPlaylist(screenId: string) {
    const screen = await this.prisma.screen.findUnique({
      where: { id: screenId },
      include: {
        playlist: {
          include: { items: { orderBy: { position: 'asc' }, include: { asset: true } } },
        },
      },
    });
    if (!screen) throw new NotFoundException('Screen not found');
    if (!screen.playlist) return null;

    return this.hydratePlaylist(screen.playlist);
  }

  /**
   * Full player state:
   *   - emergencyActive + emergencyPlaylist (takes priority over everything)
   *   - layout with signed-URL playlists per zone (if a layout is assigned)
   *   - scheduleRules (with their playlists pre-fetched) for local resolver
   *   - defaultPlaylist as fallback when no schedule rule matches
   */
  async getState(screenId: string) {
    const screen = await this.prisma.screen.findUnique({
      where: { id: screenId },
      include: {
        emergencyPlaylist: {
          include: { items: { orderBy: { position: 'asc' }, include: { asset: true } } },
        },
        layout: {
          include: {
            zones: {
              orderBy: { zIndex: 'asc' },
              include: {
                playlist: {
                  include: { items: { orderBy: { position: 'asc' }, include: { asset: true } } },
                },
              },
            },
          },
        },
        theme: true,
        asset: true,
        playlist: {
          include: { items: { orderBy: { position: 'asc' }, include: { asset: true } } },
        },
      },
    });
    if (!screen) throw new NotFoundException('Screen not found');

    const rules = await this.schedules.getSchedulesForScreen(screenId);

    // Collect all unique playlist IDs needed by schedule rules
    const rulePlaylistIds = [...new Set(rules.map(r => r.playlistId))];
    const rulePlaylists = await Promise.all(
      rulePlaylistIds.map(id =>
        this.prisma.playlist.findUnique({
          where: { id },
          include: { items: { orderBy: { position: 'asc' }, include: { asset: true } } },
        }),
      ),
    );
    const rulePlaylistMap = Object.fromEntries(
      rulePlaylists.filter(Boolean).map(p => [p!.id, p!]),
    );

    // Resolve what's playing right now (server-side, as a hint)
    const resolvedPlaylistId = this.schedules.resolveNow(rules, new Date(), screen.timezone);

    const hydrateZones = async (zones: NonNullable<typeof screen.layout>['zones']) =>
      Promise.all(
        zones.map(async (z: (typeof zones)[number]) => ({
          id: z.id,
          name: z.name,
          x: z.x,
          y: z.y,
          width: z.width,
          height: z.height,
          zIndex: z.zIndex,
          zoneType: z.zoneType,
          widgetConfig: z.widgetConfig,
          playlist: z.playlist ? await this.hydratePlaylist(z.playlist) : null,
        })),
      );

    return {
      screenId,
      timezone: screen.timezone,
      latitude: screen.latitude,
      longitude: screen.longitude,
      prayerMethod: screen.prayerMethod,
      athanEnabled: screen.athanEnabled,
      emergencyActive: screen.emergencyActive,
      emergencyPlaylist: screen.emergencyPlaylist
        ? await this.hydratePlaylist(screen.emergencyPlaylist)
        : null,
      layout: screen.layout
        ? { id: screen.layout.id, name: screen.layout.name, zones: await hydrateZones(screen.layout.zones) }
        : null,
      theme: screen.theme
        ? {
            id: screen.theme.id,
            name: screen.theme.name,
            category: screen.theme.category,
            aspectRatio: screen.theme.aspectRatio,
            palette: screen.theme.palette,
            typography: screen.theme.typography,
            elements: await this.hydrateThemeElements(screen.theme.elements),
          }
        : null,
      scheduleRules: await Promise.all(
        rules.map(async r => ({
          id: r.id,
          name: r.name,
          priority: r.priority,
          startTime: r.startTime,
          endTime: r.endTime,
          daysOfWeek: r.daysOfWeek,
          startDate: r.startDate?.toISOString() ?? null,
          endDate: r.endDate?.toISOString() ?? null,
          playlistId: r.playlistId,
          playlist: rulePlaylistMap[r.playlistId]
            ? await this.hydratePlaylist(rulePlaylistMap[r.playlistId]!)
            : null,
        })),
      ),
      resolvedPlaylistId,
      defaultPlaylist:
        (screen.contentType === 'VIDEO' || screen.contentType === 'IMAGE') && screen.asset
          ? this.hydrateAssetAsPlaylist(screen.asset)
          : screen.playlist
            ? await this.hydratePlaylist(screen.playlist)
            : null,
    };
  }

  async heartbeat(screenId: string, _currentAssetId: string | null) {
    const screen = await this.prisma.screen.update({
      where: { id: screenId },
      data: { lastSeenAt: new Date(), status: 'ONLINE' },
    });
    if (screen.organizationId) {
      this.gateway.sendStatusToOrg(screen.organizationId, screenId, 'ONLINE');
    }
    return { ok: true };
  }

  /**
   * Theme elements reference assets/playlists by id (like layout zones do). Resolve IMAGE/VIDEO
   * elements to a signed-URL, and PLAYLIST elements to a fully hydrated playlist — everything
   * else (TEXT/SHAPE/WIDGET) passes through untouched.
   */
  private async hydrateThemeElements(elements: unknown): Promise<unknown> {
    if (!Array.isArray(elements)) return [];
    const els = elements as { kind: string; content: Record<string, unknown> }[];

    const assetIds = [...new Set(
      els.filter(e => e.kind === 'IMAGE' || e.kind === 'VIDEO')
        .map(e => e.content.assetId as string | null)
        .filter((id): id is string => !!id),
    )];
    const playlistIds = [...new Set(
      els.filter(e => e.kind === 'PLAYLIST')
        .map(e => e.content.playlistId as string | null)
        .filter((id): id is string => !!id),
    )];

    const assets = assetIds.length
      ? await this.prisma.asset.findMany({ where: { id: { in: assetIds } } })
      : [];
    const assetMap = new Map(assets.map(a => [a.id, this.storage.publicUrl(a.storageKey)]));

    const playlists = playlistIds.length
      ? await this.prisma.playlist.findMany({
          where: { id: { in: playlistIds } },
          include: { items: { orderBy: { position: 'asc' }, include: { asset: true } } },
        })
      : [];
    const playlistMap = new Map(
      await Promise.all(playlists.map(async p => [p.id, await this.hydratePlaylist(p)] as const)),
    );

    return els.map(e => {
      if (e.kind === 'IMAGE' || e.kind === 'VIDEO') {
        const assetId = e.content.assetId as string | null;
        return { ...e, content: { assetId, url: assetId ? (assetMap.get(assetId) ?? null) : null } };
      }
      if (e.kind === 'PLAYLIST') {
        const playlistId = e.content.playlistId as string | null;
        return { ...e, content: { playlistId, playlist: playlistId ? (playlistMap.get(playlistId) ?? null) : null } };
      }
      return e;
    });
  }

  // A screen's "Video"/"Image" streaming type assigns a single asset directly rather than a
  // playlist — wrap it as a one-item playlist so the player can keep using the same
  // ZonePlayer/resolvePlaylist path as every other content type.
  private hydrateAssetAsPlaylist(asset: {
    id: string; name: string; type: string; mimeType: string; storageKey: string; thumbnailKey: string | null; durationSecs: number | null;
  }) {
    return {
      id: `asset-${asset.id}`,
      name: asset.name,
      items: [{
        id: asset.id,
        position: 0,
        durationSecs: asset.durationSecs ? Math.ceil(asset.durationSecs) : 10,
        muted: true,
        playFullVideo: true,
        asset: {
          id: asset.id,
          name: asset.name,
          type: asset.type,
          mimeType: asset.mimeType,
          url: this.storage.publicUrl(asset.storageKey),
          thumbnailUrl: asset.thumbnailKey ? this.storage.publicUrl(asset.thumbnailKey) : null,
        },
      }],
    };
  }

  private async hydratePlaylist(playlist: {
    id: string;
    name: string;
    items: { id: string; position: number; durationSecs: number; muted: boolean; playFullVideo: boolean; asset: { id: string; name: string; type: string; mimeType: string; storageKey: string; thumbnailKey: string | null } }[];
  }) {
    const items = await Promise.all(
      playlist.items.map(item => ({
        id: item.id,
        position: item.position,
        durationSecs: item.durationSecs,
        muted: item.muted,
        playFullVideo: item.playFullVideo,
        asset: {
          id: item.asset.id,
          name: item.asset.name,
          type: item.asset.type,
          mimeType: item.asset.mimeType,
          url: this.storage.publicUrl(item.asset.storageKey),
          thumbnailUrl: item.asset.thumbnailKey
            ? this.storage.publicUrl(item.asset.thumbnailKey)
            : null,
        },
      })),
    );
    return { id: playlist.id, name: playlist.name, items };
  }
}
