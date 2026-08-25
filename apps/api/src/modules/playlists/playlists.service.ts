import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { UserRole, TransitionStyle, PlaybackOrder } from '@lumina/db';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { OrgScopedService } from '../../common/org-scoped.service';

@Injectable()
export class PlaylistsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly orgScoped: OrgScopedService,
  ) {}

  async create(orgId: string, name: string, creatorRole: UserRole) {
    // Editors submit content for review; owners/admins publish directly.
    const approvalStatus = creatorRole === 'EDITOR' ? 'DRAFT' : 'APPROVED';
    return this.prisma.playlist.create({ data: { name, organizationId: orgId, approvalStatus } });
  }

  async list(orgId: string) {
    const playlists = await this.prisma.playlist.findMany({
      where: { organizationId: orgId },
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: { select: { items: true } },
        items: { select: { durationSecs: true, asset: { select: { sizeBytes: true } } } },
      },
    });
    // The row list only needs the totals, not the items themselves — drop them here so the
    // frontend's PlaylistSummary type (no `items`) stays honest about what this endpoint returns.
    return playlists.map(({ items, ...playlist }) => ({
      ...playlist,
      totalDurationSecs: items.reduce((sum: number, i: (typeof items)[number]) => sum + i.durationSecs, 0),
      totalSizeBytes: items.reduce((sum: number, i: (typeof items)[number]) => sum + Number(i.asset?.sizeBytes ?? 0), 0),
    }));
  }

  async findOne(orgId: string, id: string) {
    const playlist = await this.orgScoped.assertOwns(
      () => this.prisma.playlist.findFirst({
        where: { id, organizationId: orgId },
        include: {
          items: {
            orderBy: { position: 'asc' },
            include: { asset: true, theme: { select: { id: true, name: true, category: true } }, layout: { select: { id: true, name: true } } },
          },
        },
      }),
      'Playlist not found',
    );

    const itemsWithUrls = playlist.items.map((item: (typeof playlist.items)[number]) => this.shapeItem(item));

    return { ...playlist, items: itemsWithUrls };
  }

  // Callers (addItem, updateItem, findOne) need the same shape — an ASSET item's sizeBytes
  // coerced from bigint and storage keys resolved to fetchable URLs; a THEME/LAYOUT item just
  // passes its (already light: id/name/category or id/name) theme/layout through untouched —
  // the dashboard editor only needs enough to render a row, not the player's full hydration.
  private shapeItem<T extends {
    kind: string;
    asset: { type: string; storageKey: string; thumbnailKey: string | null; pageCount: number | null; sizeBytes: bigint } | null;
  }>(item: T) {
    const asset = item.asset;
    if (item.kind !== 'ASSET' || !asset) return { ...item, asset: null };

    // TEXT assets have no real object behind storageKey (see AssetsService.createText) — a
    // "url" built from it would 404, so leave it null and let the frontend/player render
    // asset.textContent instead.
    const isText = asset.type === 'TEXT';
    return {
      ...item,
      asset: {
        ...asset,
        sizeBytes: Number(asset.sizeBytes),
        url: isText ? null : this.storage.publicUrl(asset.storageKey),
        thumbnailUrl: !isText && asset.thumbnailKey
          ? this.storage.publicUrl(asset.thumbnailKey)
          : null,
        pageUrls: asset.type === 'DOCUMENT'
          ? Array.from({ length: asset.pageCount ?? 0 }, (_, i) =>
              this.storage.publicUrl(asset.storageKey.replace(/(\.[^.]+)$/, `_p${i + 1}.webp`)),
            )
          : [],
      },
    };
  }

  async rename(orgId: string, id: string, name: string) {
    await this.assertOwns(orgId, id);
    return this.prisma.playlist.update({ where: { id }, data: { name } });
  }

  async updateConfig(
    orgId: string,
    id: string,
    dto: { transitionStyle?: TransitionStyle; transitionDurationMs?: number; playbackOrder?: PlaybackOrder },
  ) {
    await this.assertOwns(orgId, id);
    return this.prisma.playlist.update({ where: { id }, data: dto });
  }

  async remove(orgId: string, id: string) {
    await this.assertOwns(orgId, id);

    // None of Screen (default/emergency playlist), Zone, or Schedule cascade-delete when their
    // referenced Playlist is removed — check first so an in-use playlist gets a clear error
    // instead of a raw foreign-key failure (see the identical fix on asset deletion).
    const [screenCount, zoneCount, scheduleCount] = await Promise.all([
      this.prisma.screen.count({ where: { OR: [{ playlistId: id }, { emergencyPlaylistId: id }] } }),
      this.prisma.zone.count({ where: { playlistId: id } }),
      this.prisma.schedule.count({ where: { playlistId: id } }),
    ]);
    const usageCount = screenCount + zoneCount + scheduleCount;
    if (usageCount > 0) {
      throw new BadRequestException(
        `This playlist is in use (${usageCount} reference${usageCount === 1 ? '' : 's'} across screens, layout zones, or schedules). Remove those references before deleting.`,
      );
    }

    await this.prisma.playlist.delete({ where: { id } });
  }

  async addItem(
    orgId: string, playlistId: string, kind: 'ASSET' | 'THEME' | 'LAYOUT', durationSecs: number,
    refs: { assetId?: string; themeId?: string; layoutId?: string },
    muted?: boolean, playFullVideo?: boolean,
    cropZoom?: number, cropOffsetX?: number, cropOffsetY?: number,
  ) {
    await this.assertOwns(orgId, playlistId);

    const last = await this.prisma.playlistItem.findFirst({
      where: { playlistId },
      orderBy: { position: 'desc' },
    });
    const position = (last?.position ?? -1) + 1;

    if (kind === 'THEME') {
      if (!refs.themeId) throw new BadRequestException('themeId is required for a THEME item');
      await this.orgScoped.assertOwns(
        () => this.prisma.theme.findFirst({
          where: { id: refs.themeId, OR: [{ organizationId: null }, { organizationId: orgId }] },
        }),
        'Theme not found',
      );
      const created = await this.prisma.playlistItem.create({
        data: { playlistId, position, durationSecs, kind: 'THEME', themeId: refs.themeId },
        include: { asset: true, theme: { select: { id: true, name: true, category: true } }, layout: { select: { id: true, name: true } } },
      });
      return this.shapeItem(created);
    }

    if (kind === 'LAYOUT') {
      if (!refs.layoutId) throw new BadRequestException('layoutId is required for a LAYOUT item');
      await this.orgScoped.assertOwns(
        () => this.prisma.layout.findFirst({ where: { id: refs.layoutId, organizationId: orgId } }),
        'Layout not found',
      );
      const created = await this.prisma.playlistItem.create({
        data: { playlistId, position, durationSecs, kind: 'LAYOUT', layoutId: refs.layoutId },
        include: { asset: true, theme: { select: { id: true, name: true, category: true } }, layout: { select: { id: true, name: true } } },
      });
      return this.shapeItem(created);
    }

    if (!refs.assetId) throw new BadRequestException('assetId is required for an ASSET item');
    const asset = await this.orgScoped.assertOwns(
      () => this.prisma.asset.findFirst({ where: { id: refs.assetId, organizationId: orgId } }),
      'Asset not found',
    );

    // When the caller doesn't specify, default to the asset's own audio choice (from upload/the
    // assets page) rather than the DB column's blanket `true` — otherwise a video whose audio
    // was explicitly enabled still lands muted the first time it's placed anywhere, since
    // nothing in the dashboard ever offers to unmute a placement today. VIDEO only gets sound
    // once a track's actually been detected on it; every other audio-capable type (currently
    // just APP/YouTube, which has no hasAudioTrack probe of its own) just follows the asset's
    // own audio toggle, defaulting to unmuted.
    const initialMuted = muted !== undefined ? muted
      : asset.type === 'VIDEO' ? (asset.hasAudioTrack ? !asset.audioEnabled : true)
      : !asset.audioEnabled;
    const created = await this.prisma.playlistItem.create({
      data: {
        playlistId, position, durationSecs, kind: 'ASSET', assetId: refs.assetId,
        muted: initialMuted,
        ...(playFullVideo !== undefined && { playFullVideo }),
        ...(cropZoom !== undefined && { cropZoom, cropOffsetX, cropOffsetY }),
      },
      include: { asset: true, theme: { select: { id: true, name: true, category: true } }, layout: { select: { id: true, name: true } } },
    });
    return this.shapeItem(created);
  }

  async updateItem(
    orgId: string, playlistId: string, itemId: string, durationSecs: number, muted?: boolean, playFullVideo?: boolean,
    cropZoom?: number | null, cropOffsetX?: number | null, cropOffsetY?: number | null,
  ) {
    await this.assertOwns(orgId, playlistId);
    await this.assertItemBelongs(playlistId, itemId);
    const updated = await this.prisma.playlistItem.update({
      where: { id: itemId },
      data: {
        durationSecs,
        ...(muted !== undefined && { muted }),
        ...(playFullVideo !== undefined && { playFullVideo }),
        // Explicit null (not just omitted) is how the crop editor's "reset to full image"
        // clears a previously-set crop, so this checks arg *presence* on the request, not
        // truthiness — same reasoning as muted/playFullVideo above, but null-inclusive.
        ...(cropZoom !== undefined && { cropZoom, cropOffsetX, cropOffsetY }),
      },
      include: { asset: true, theme: { select: { id: true, name: true, category: true } }, layout: { select: { id: true, name: true } } },
    });
    return this.shapeItem(updated);
  }

  async removeItem(orgId: string, playlistId: string, itemId: string) {
    await this.assertOwns(orgId, playlistId);
    await this.assertItemBelongs(playlistId, itemId);
    // The delete and the re-sequence below used to run as independent statements; a failure
    // partway through the re-sequence (e.g. a dropped connection) left duplicate/gapped
    // `position` values, so the player renders items in whatever tie-break order Postgres
    // happens to return — silent content misordering on live screens.
    await this.prisma.$transaction(async tx => {
      await tx.playlistItem.delete({ where: { id: itemId } });
      const remaining = await tx.playlistItem.findMany({
        where: { playlistId },
        orderBy: { position: 'asc' },
      });
      await Promise.all(
        remaining.map((item: (typeof remaining)[number], i: number) =>
          tx.playlistItem.update({ where: { id: item.id }, data: { position: i } }),
        ),
      );
    });
  }

  async reorderItems(orgId: string, playlistId: string, orderedIds: string[]) {
    await this.assertOwns(orgId, playlistId);
    const ownedCount = await this.prisma.playlistItem.count({
      where: { id: { in: orderedIds }, playlistId },
    });
    if (ownedCount !== orderedIds.length) throw new NotFoundException('Playlist item not found');
    // Same atomicity concern as removeItem's re-sequence above — a partial failure mid-batch
    // must not leave the playlist with duplicate/gapped positions.
    await this.prisma.$transaction(async tx =>
      Promise.all(orderedIds.map((id, i) => tx.playlistItem.update({ where: { id }, data: { position: i } }))),
    );
  }

  async submit(orgId: string, id: string) {
    const playlist = await this.assertOwns(orgId, id);
    if (!['DRAFT', 'REJECTED'].includes(playlist.approvalStatus)) {
      throw new BadRequestException('Only draft or rejected playlists can be submitted for review');
    }
    return this.prisma.playlist.update({ where: { id }, data: { approvalStatus: 'PENDING' } });
  }

  async approve(orgId: string, id: string) {
    const playlist = await this.assertOwns(orgId, id);
    if (playlist.approvalStatus !== 'PENDING') {
      throw new BadRequestException('Only playlists pending review can be approved');
    }
    return this.prisma.playlist.update({ where: { id }, data: { approvalStatus: 'APPROVED' } });
  }

  async reject(orgId: string, id: string) {
    const playlist = await this.assertOwns(orgId, id);
    if (playlist.approvalStatus !== 'PENDING') {
      throw new BadRequestException('Only playlists pending review can be rejected');
    }
    return this.prisma.playlist.update({ where: { id }, data: { approvalStatus: 'REJECTED' } });
  }

  private async assertOwns(orgId: string, id: string) {
    return this.orgScoped.assertOwns(
      () => this.prisma.playlist.findFirst({ where: { id, organizationId: orgId } }),
      'Playlist not found',
    );
  }

  // updateItem/removeItem/reorderItems take itemId(s) from the request body; assertOwns only
  // confirms the *playlist* is in the caller's org, so without this a caller could pass any
  // playlistItem id — including one belonging to another org's playlist — and mutate it.
  private async assertItemBelongs(playlistId: string, itemId: string) {
    await this.orgScoped.assertOwns(
      () => this.prisma.playlistItem.findFirst({ where: { id: itemId, playlistId } }),
      'Playlist item not found',
    );
  }
}
