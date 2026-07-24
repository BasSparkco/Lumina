import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AssetCategory, AssetType } from '@lumina/db';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

// Exported so the developer-facing library seed script (prisma/seed-library.ts) validates
// files against the exact same mimetype allowlist as the upload endpoint.
export const ALLOWED_MIME: Record<string, AssetType> = {
  'image/jpeg': 'IMAGE',
  'image/png': 'IMAGE',
  'image/gif': 'IMAGE',
  'image/webp': 'IMAGE',
  'video/mp4': 'VIDEO',
  'video/webm': 'VIDEO',
  'video/quicktime': 'VIDEO',
  'audio/mpeg': 'AUDIO',
  'audio/mp4': 'AUDIO',
  'audio/wav': 'AUDIO',
};

@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async upload(
    orgId: string,
    file: Express.Multer.File,
    queueThumbnail: (assetId: string, key: string, type: AssetType) => Promise<void>,
  ) {
    const assetType = ALLOWED_MIME[file.mimetype];
    if (!assetType) throw new BadRequestException(`Unsupported file type: ${file.mimetype}`);

    const ext = file.originalname.split('.').pop() ?? 'bin';
    const key = `${orgId}/assets/${crypto.randomUUID()}.${ext}`;

    await this.storage.upload(key, file.buffer, file.mimetype);

    const asset = await this.prisma.asset.create({
      data: {
        name: file.originalname,
        type: assetType,
        mimeType: file.mimetype,
        storageKey: key,
        sizeBytes: file.size,
        organizationId: orgId,
        status: 'PROCESSING',
      },
    });

    await queueThumbnail(asset.id, key, assetType);

    return this.toDto(asset, null);
  }

  async list(orgId: string) {
    const assets = await this.prisma.asset.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(
      assets.map(async (a: (typeof assets)[number]) => {
        const url = this.storage.publicUrl(a.storageKey);
        const downloadUrl = this.storage.publicUrl(a.storageKey, a.name);
        const thumbUrl = a.thumbnailKey ? this.storage.publicUrl(a.thumbnailKey) : null;
        return this.toDto(a, url, thumbUrl, downloadUrl);
      }),
    );
  }

  /** Stock assets (organizationId: null) uploaded by us via the seed-library script — every org can browse and copy them, none can edit or delete them. */
  async listLibrary(category?: AssetCategory, search?: string) {
    const assets = await this.prisma.asset.findMany({
      where: {
        organizationId: null,
        status: 'READY',
        ...(category && { category }),
        ...(search && {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { tags: { has: search.toLowerCase() } },
          ],
        }),
      },
      orderBy: { createdAt: 'desc' },
    });
    return assets.map((a: (typeof assets)[number]) => {
      const url = this.storage.publicUrl(a.storageKey);
      const thumbUrl = a.thumbnailKey ? this.storage.publicUrl(a.thumbnailKey) : null;
      return this.toDto(a, url, thumbUrl, null);
    });
  }

  /** Copies a library asset into the org's own asset collection — same storageKey (no re-upload), new row so rename/delete/playlist references work exactly like any other org asset. */
  async copyFromLibrary(orgId: string, id: string) {
    const source = await this.prisma.asset.findFirst({ where: { id, organizationId: null } });
    if (!source) throw new NotFoundException('Library asset not found');

    const copy = await this.prisma.asset.create({
      data: {
        name: source.name,
        type: source.type,
        mimeType: source.mimeType,
        storageKey: source.storageKey,
        thumbnailKey: source.thumbnailKey,
        sizeBytes: source.sizeBytes,
        durationSecs: source.durationSecs,
        width: source.width,
        height: source.height,
        category: source.category,
        tags: source.tags,
        status: 'READY',
        organizationId: orgId,
      },
    });

    const url = this.storage.publicUrl(copy.storageKey);
    const downloadUrl = this.storage.publicUrl(copy.storageKey, copy.name);
    const thumbUrl = copy.thumbnailKey ? this.storage.publicUrl(copy.thumbnailKey) : null;
    return this.toDto(copy, url, thumbUrl, downloadUrl);
  }

  async findOne(orgId: string, id: string) {
    const asset = await this.prisma.asset.findFirst({ where: { id, organizationId: orgId } });
    if (!asset) throw new NotFoundException('Asset not found');

    const url = this.storage.publicUrl(asset.storageKey);
    const downloadUrl = this.storage.publicUrl(asset.storageKey, asset.name);
    const thumbUrl = asset.thumbnailKey ? this.storage.publicUrl(asset.thumbnailKey) : null;
    return this.toDto(asset, url, thumbUrl, downloadUrl);
  }

  async rename(orgId: string, id: string, name: string) {
    const asset = await this.prisma.asset.findFirst({ where: { id, organizationId: orgId } });
    if (!asset) throw new NotFoundException('Asset not found');
    return this.toDto(await this.prisma.asset.update({ where: { id }, data: { name } }), null);
  }

  async remove(orgId: string, id: string) {
    const asset = await this.prisma.asset.findFirst({ where: { id, organizationId: orgId } });
    if (!asset) throw new NotFoundException('Asset not found');

    // Check for playlist references *before* touching storage — Asset -> PlaylistItem has no
    // onDelete: Cascade, so prisma.asset.delete() throws a foreign-key error for an in-use
    // asset. Previously that check ran last, after the storage files were already deleted:
    // the delete would fail here, but the actual file was already gone, leaving a DB row
    // with dead storageKey/thumbnailKey references (a broken preview that a real refresh
    // wouldn't fix, since the row was never actually removed).
    const usageCount = await this.prisma.playlistItem.count({ where: { assetId: id } });
    if (usageCount > 0) {
      throw new BadRequestException(
        `This asset is used in ${usageCount} playlist item${usageCount === 1 ? '' : 's'}. Remove it from those playlists before deleting.`,
      );
    }

    // Assets copied from the library (see copyFromLibrary) share their storageKey/thumbnailKey
    // with the library original and every other org's copy — only delete the actual object once
    // nothing else still points at it, or every other copy silently loses its file underneath it.
    const otherRefs = await this.prisma.asset.count({ where: { storageKey: asset.storageKey, id: { not: id } } });
    if (otherRefs === 0) {
      await this.storage.delete(asset.storageKey);
      if (asset.thumbnailKey) await this.storage.delete(asset.thumbnailKey);
    }
    await this.prisma.asset.delete({ where: { id } });
  }

  private toDto(
    asset: { id: string; name: string; type: AssetType; mimeType: string; storageKey: string; thumbnailKey: string | null; sizeBytes: bigint; durationSecs: number | null; width: number | null; height: number | null; status: string; category: AssetCategory; tags: string[]; organizationId: string | null; createdAt: Date },
    url: string | null,
    thumbUrl?: string | null,
    downloadUrl?: string | null,
  ) {
    return {
      id: asset.id,
      name: asset.name,
      type: asset.type,
      mimeType: asset.mimeType,
      sizeBytes: Number(asset.sizeBytes),
      durationSecs: asset.durationSecs,
      width: asset.width,
      height: asset.height,
      status: asset.status,
      category: asset.category,
      tags: asset.tags,
      url,
      thumbnailUrl: thumbUrl ?? null,
      downloadUrl: downloadUrl ?? null,
      organizationId: asset.organizationId,
      createdAt: asset.createdAt.toISOString(),
    };
  }
}
