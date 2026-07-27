import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ScreenGateway } from '../ws/screen.gateway';
import { SchedulesService } from '../schedules/schedules.service';
import { PowerSchedulesService } from '../power-schedules/power-schedules.service';

@Injectable()
export class PlayerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly gateway: ScreenGateway,
    private readonly schedules: SchedulesService,
    private readonly powerSchedules: PowerSchedulesService,
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
   *   - poweredOn + powerScheduleRules (highest priority — outside its window the display
   *     blanks to black regardless of everything below, including stopped/emergency)
   *   - stopped (blanks the screen regardless of everything below, including an active
   *     emergency override)
   *   - emergencyActive + emergencyPlaylist (takes priority over layout/schedule)
   *   - layout with signed-URL playlists per zone (if a layout is assigned)
   *   - scheduleRules (with their playlists pre-fetched) for local resolver
   *   - defaultPlaylist as fallback when no schedule rule matches
   *   - volume (0-100): the screen's own value, else its group's, else 100
   */
  async getState(screenId: string) {
    const screen = await this.prisma.screen.findUnique({
      where: { id: screenId },
      include: {
        asset: true,
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
                asset: true,
              },
            },
          },
        },
        playlist: {
          include: { items: { orderBy: { position: 'asc' }, include: { asset: true } } },
        },
        group: { select: { volume: true } },
      },
    });
    if (!screen) throw new NotFoundException('Screen not found');

    // Schedule rules only ever resolve a *playlist* to swap in/out — meaningless (and, if left
    // computed, a source of stale leakage) outside Playlist mode: a screen that used to be
    // Playlist mode with Schedule rows still in the DB, then switched to Asset or Layout mode,
    // would otherwise still resolve and could leak a scheduled playlist through.
    const rules = screen.streamingType === 'PLAYLIST' ? await this.schedules.getSchedulesForScreen(screenId) : [];

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
    const resolvedPlaylistId = screen.streamingType === 'PLAYLIST'
      ? this.schedules.resolveNow(rules, new Date(), screen.timezone)
      : null;

    // Item 6 (display power schedule) — screen-level rules override the screen's group's; no
    // rules anywhere means the feature is unset for this screen, i.e. always on.
    const power = await this.powerSchedules.resolveForScreen(screen);

    // Item 10 (volume control) — screen's own value wins, else its group's, else full volume.
    const volume = screen.volume ?? screen.group?.volume ?? 100;

    const hydrateZones = (zones: NonNullable<typeof screen.layout>['zones']) =>
      zones.map((z: (typeof zones)[number]) => ({
        id: z.id,
        name: z.name,
        x: z.x,
        y: z.y,
        width: z.width,
        height: z.height,
        zIndex: z.zIndex,
        zoneType: z.zoneType,
        widgetConfig: z.widgetConfig,
        audioPriority: z.audioPriority,
        audioVolume: z.audioVolume,
        // A zone's MEDIA content is either a playlist or a single asset, never both (enforced
        // in LayoutsService) — asset wins the null-coalesce below only because at most one of
        // the two is ever actually set.
        playlist: z.playlist ? this.hydratePlaylist(z.playlist) : z.asset ? this.hydrateAssetAsPlaylist(z.asset) : null,
      }));

    return {
      screenId,
      streamingType: screen.streamingType,
      timezone: screen.timezone,
      latitude: screen.latitude,
      longitude: screen.longitude,
      prayerMethod: screen.prayerMethod,
      athanEnabled: screen.athanEnabled,
      stopped: screen.stopped,
      emergencyActive: screen.emergencyActive,
      emergencyPlaylist: screen.emergencyPlaylist
        ? this.hydratePlaylist(screen.emergencyPlaylist)
        : null,
      asset: screen.streamingType === 'ASSET' && screen.asset ? this.hydrateAssetAsPlaylist(screen.asset) : null,
      layout: screen.streamingType === 'LAYOUT' && screen.layout
        ? { id: screen.layout.id, name: screen.layout.name, zones: hydrateZones(screen.layout.zones) }
        : null,
      scheduleRules: rules.map(r => ({
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
          ? this.hydratePlaylist(rulePlaylistMap[r.playlistId]!)
          : null,
      })),
      resolvedPlaylistId,
      defaultPlaylist: screen.streamingType === 'PLAYLIST' && screen.playlist ? this.hydratePlaylist(screen.playlist) : null,
      poweredOn: power.poweredOn,
      powerScheduleRules: power.rules.map(r => ({
        id: r.id,
        daysOfWeek: r.daysOfWeek,
        startTime: r.startTime,
        endTime: r.endTime,
      })),
      volume,
    };
  }

  // A raw Asset played standalone (Screen-level ASSET streaming mode, or a Zone's asset media
  // mode) has no PlaylistItem to carry a placement-specific duration/muted flag, so this
  // fabricates a single-item playlist reusing hydratePlaylist's URL/thumbnail/TEXT handling —
  // letting the player's existing single-item-playlist looping render it with no new code path.
  // durationSecs mirrors the PlaylistItem schema default; muted follows the asset's own audio
  // choice, since that's the only place such a choice can be recorded for a non-playlist placement.
  private hydrateAssetAsPlaylist(asset: {
    id: string; name: string; type: string; mimeType: string; storageKey: string; thumbnailKey: string | null;
    textContent: string | null; textFontFamily: string | null; textColor: string | null; textSize: string | null; textBackgroundColor: string | null;
    hasAudioTrack: boolean; audioEnabled: boolean;
  }) {
    return this.hydratePlaylist({
      id: `asset:${asset.id}`,
      name: asset.name,
      transitionStyle: 'NONE',
      transitionDurationMs: 0,
      playbackOrder: 'SEQUENTIAL',
      items: [{
        id: `asset-item:${asset.id}`,
        position: 0,
        durationSecs: 10,
        muted: asset.type === 'VIDEO' && asset.hasAudioTrack ? !asset.audioEnabled : true,
        asset,
      }],
    });
  }

  async uploadScreenshot(orgId: string, screenId: string, jpeg: Buffer) {
    await this.storage.upload(this.storage.screenshotKey(orgId, screenId), jpeg, 'image/jpeg');
    await this.prisma.screen.update({ where: { id: screenId }, data: { screenshotUpdatedAt: new Date() } });
    return { ok: true };
  }

  async ingestCrashReports(orgId: string, screenId: string, events: { type: string; summary: string; stackTrace?: string; occurredAt: string }[]) {
    if (events.length === 0) return { ok: true, count: 0 };
    const { count } = await this.prisma.crashReport.createMany({
      data: events.map(e => ({
        screenId,
        organizationId: orgId,
        type: e.type,
        summary: e.summary,
        stackTrace: e.stackTrace,
        occurredAt: new Date(e.occurredAt),
      })),
    });
    return { ok: true, count };
  }

  async heartbeat(screenId: string, _currentAssetId: string | null, hasContent?: boolean) {
    const screen = await this.prisma.screen.update({
      where: { id: screenId },
      data: {
        lastSeenAt: new Date(),
        status: 'ONLINE',
        // Only the player knows whether *right now* actually resolves to playable content
        // (schedule gaps, locally-resolved layout zones) — omit means "unchanged," not "false,"
        // so older player builds that don't send this yet don't flip screens to the badge.
        ...(hasContent !== undefined ? { hasContent } : {}),
      },
    });
    if (screen.organizationId) {
      this.gateway.sendStatusToOrg(screen.organizationId, screenId, 'ONLINE');
    }
    return { ok: true };
  }

  private hydratePlaylist(playlist: {
    id: string;
    name: string;
    transitionStyle: string;
    transitionDurationMs: number;
    playbackOrder: string;
    items: { id: string; position: number; durationSecs: number; muted: boolean; asset: { id: string; name: string; type: string; mimeType: string; storageKey: string; thumbnailKey: string | null; textContent: string | null; textFontFamily: string | null; textColor: string | null; textSize: string | null; textBackgroundColor: string | null } }[];
  }) {
    const items = playlist.items.map(item => {
      // TEXT assets have no real object behind storageKey (see AssetsService.createText) —
      // the player renders textContent directly instead of loading a url.
      const isText = item.asset.type === 'TEXT';
      return {
        id: item.id,
        position: item.position,
        durationSecs: item.durationSecs,
        muted: item.muted,
        asset: {
          id: item.asset.id,
          name: item.asset.name,
          type: item.asset.type,
          mimeType: item.asset.mimeType,
          url: isText ? null : this.storage.publicUrl(item.asset.storageKey),
          thumbnailUrl: !isText && item.asset.thumbnailKey
            ? this.storage.publicUrl(item.asset.thumbnailKey)
            : null,
          textContent: item.asset.textContent,
          textFontFamily: item.asset.textFontFamily,
          textColor: item.asset.textColor,
          textSize: item.asset.textSize,
          textBackgroundColor: item.asset.textBackgroundColor,
        },
      };
    });
    return {
      id: playlist.id,
      name: playlist.name,
      transitionStyle: playlist.transitionStyle,
      transitionDurationMs: playlist.transitionDurationMs,
      playbackOrder: playlist.playbackOrder,
      items,
    };
  }
}
