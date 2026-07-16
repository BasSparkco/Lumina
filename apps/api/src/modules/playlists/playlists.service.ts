import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { UserRole, TransitionStyle, PlaybackOrder } from '@lumina/db';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class PlaylistsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async create(orgId: string, name: string, creatorRole: UserRole) {
    // Editors submit content for review; owners/admins publish directly.
    const approvalStatus = creatorRole === 'EDITOR' ? 'DRAFT' : 'APPROVED';
    return this.prisma.playlist.create({ data: { name, organizationId: orgId, approvalStatus } });
  }

  async list(orgId: string) {
    return this.prisma.playlist.findMany({
      where: { organizationId: orgId },
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { items: true } } },
    });
  }

  async findOne(orgId: string, id: string) {
    const playlist = await this.prisma.playlist.findFirst({
      where: { id, organizationId: orgId },
      include: {
        items: {
          orderBy: { position: 'asc' },
          include: { asset: true },
        },
      },
    });
    if (!playlist) throw new NotFoundException('Playlist not found');

    const itemsWithUrls = playlist.items.map((item: (typeof playlist.items)[number]) => this.withAssetUrls(item));

    return { ...playlist, items: itemsWithUrls };
  }

  private withAssetUrls<T extends { asset: { type: string; storageKey: string; thumbnailKey: string | null; sizeBytes: bigint } }>(
    item: T,
  ) {
    // TEXT assets have no real object behind storageKey (see AssetsService.createText) — a
    // "url" built from it would 404, so leave it null and let the frontend/player render
    // asset.textContent instead.
    const isText = item.asset.type === 'TEXT';
    return {
      ...item,
      asset: {
        ...item.asset,
        sizeBytes: Number(item.asset.sizeBytes),
        url: isText ? null : this.storage.publicUrl(item.asset.storageKey),
        thumbnailUrl: !isText && item.asset.thumbnailKey
          ? this.storage.publicUrl(item.asset.thumbnailKey)
          : null,
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

  async addItem(orgId: string, playlistId: string, assetId: string, durationSecs: number, muted?: boolean) {
    await this.assertOwns(orgId, playlistId);
    const asset = await this.prisma.asset.findFirst({ where: { id: assetId, organizationId: orgId } });
    if (!asset) throw new NotFoundException('Asset not found');

    const last = await this.prisma.playlistItem.findFirst({
      where: { playlistId },
      orderBy: { position: 'desc' },
    });
    const position = (last?.position ?? -1) + 1;

    const item = await this.prisma.playlistItem.create({
      data: { playlistId, assetId, position, durationSecs, ...(muted !== undefined && { muted }) },
      include: { asset: true },
    });
    return this.withAssetUrls(item);
  }

  async updateItem(orgId: string, playlistId: string, itemId: string, durationSecs: number, muted?: boolean) {
    await this.assertOwns(orgId, playlistId);
    return this.prisma.playlistItem.update({
      where: { id: itemId },
      data: { durationSecs, ...(muted !== undefined && { muted }) },
    });
  }

  async removeItem(orgId: string, playlistId: string, itemId: string) {
    await this.assertOwns(orgId, playlistId);
    await this.prisma.playlistItem.delete({ where: { id: itemId } });
    // Re-sequence positions
    const remaining = await this.prisma.playlistItem.findMany({
      where: { playlistId },
      orderBy: { position: 'asc' },
    });
    await Promise.all(
      remaining.map((item: (typeof remaining)[number], i: number) =>
        this.prisma.playlistItem.update({ where: { id: item.id }, data: { position: i } }),
      ),
    );
  }

  async reorderItems(orgId: string, playlistId: string, orderedIds: string[]) {
    await this.assertOwns(orgId, playlistId);
    await Promise.all(
      orderedIds.map((id, i) =>
        this.prisma.playlistItem.update({ where: { id }, data: { position: i } }),
      ),
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
    const p = await this.prisma.playlist.findFirst({ where: { id, organizationId: orgId } });
    if (!p) throw new NotFoundException('Playlist not found');
    return p;
  }
}
