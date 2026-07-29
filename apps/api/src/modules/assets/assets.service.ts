import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AssetCategory, AssetType, TextSize } from '@lumina/db';
import { DEFAULT_FONT_ID } from '@lumina/types';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

// Server-side defaults applied whenever a TEXT asset's style isn't specified — keeps the DB
// column meaning "explicitly chosen" vs. "use the default," while callers (dashboard, player)
// never have to special-case a null style themselves.
const DEFAULT_TEXT_STYLE = { textFontFamily: DEFAULT_FONT_ID, textColor: '#FFFFFF', textSize: 'MEDIUM' as TextSize };

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

  /** Re-queues thumbnail/transcode generation for an asset stuck in ERROR (e.g. a transient worker failure) — same queue path as upload(), just re-armed on the existing storageKey. */
  async reprocess(
    orgId: string,
    id: string,
    queueThumbnail: (assetId: string, key: string, type: AssetType) => Promise<void>,
  ) {
    const asset = await this.prisma.asset.findFirst({ where: { id, organizationId: orgId } });
    if (!asset) throw new NotFoundException('Asset not found');
    if (asset.status !== 'ERROR') throw new BadRequestException('Only a failed asset can be reprocessed');
    if (asset.type !== 'IMAGE' && asset.type !== 'VIDEO') throw new BadRequestException('This asset type has nothing to reprocess');

    const updated = await this.prisma.asset.update({ where: { id }, data: { status: 'PROCESSING' } });
    await queueThumbnail(asset.id, asset.storageKey, asset.type);
    return this.toDto(updated, null);
  }

  async createText(
    orgId: string,
    name: string,
    content: string,
    style: { textFontFamily?: string; textColor?: string; textSize?: TextSize; textBackgroundColor?: string } = {},
  ) {
    // No object ever gets uploaded for a TEXT asset — the content lives in `textContent` —
    // so storageKey is just a unique placeholder, never a real S3 key. remove() below skips
    // the storage.delete() call for this type so that placeholder is never dereferenced either.
    const asset = await this.prisma.asset.create({
      data: {
        name,
        type: 'TEXT',
        mimeType: 'text/plain',
        storageKey: `${orgId}/text/${crypto.randomUUID()}`,
        sizeBytes: Buffer.byteLength(content, 'utf8'),
        textContent: content,
        textFontFamily: style.textFontFamily ?? DEFAULT_TEXT_STYLE.textFontFamily,
        textColor: style.textColor ?? DEFAULT_TEXT_STYLE.textColor,
        textSize: style.textSize ?? DEFAULT_TEXT_STYLE.textSize,
        // Unlike font/color/size, no default here — null means transparent, i.e. the player's
        // own black background shows through, which is the historical (pre-this-field) look.
        textBackgroundColor: style.textBackgroundColor ?? null,
        organizationId: orgId,
        status: 'READY',
      },
    });
    return this.toDto(asset, null);
  }

  async updateText(
    orgId: string,
    id: string,
    dto: { name?: string; content?: string; textFontFamily?: string; textColor?: string; textSize?: TextSize; textBackgroundColor?: string },
  ) {
    const asset = await this.prisma.asset.findFirst({ where: { id, organizationId: orgId } });
    if (!asset) throw new NotFoundException('Asset not found');
    if (asset.type !== 'TEXT') throw new BadRequestException('Only text assets can be edited this way');

    const updated = await this.prisma.asset.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.content !== undefined ? { textContent: dto.content, sizeBytes: Buffer.byteLength(dto.content, 'utf8') } : {}),
        ...(dto.textFontFamily !== undefined ? { textFontFamily: dto.textFontFamily } : {}),
        ...(dto.textColor !== undefined ? { textColor: dto.textColor } : {}),
        ...(dto.textSize !== undefined ? { textSize: dto.textSize } : {}),
        ...(dto.textBackgroundColor !== undefined ? { textBackgroundColor: dto.textBackgroundColor } : {}),
      },
    });
    return this.toDto(updated, null);
  }

  async list(orgId: string) {
    const assets = await this.prisma.asset.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
    });
    return assets.map(a => {
      // TEXT assets have no real object behind storageKey (see createText) — a "url" built
      // from it would 404, so skip it and let the frontend render textContent instead.
      if (a.type === 'TEXT') return this.toDto(a, null);
      const url = this.storage.publicUrl(a.storageKey);
      const downloadUrl = this.storage.publicUrl(a.storageKey, a.name);
      const thumbUrl = a.thumbnailKey ? this.storage.publicUrl(a.thumbnailKey) : null;
      return this.toDto(a, url, thumbUrl, downloadUrl);
    });
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
    if (asset.type === 'TEXT') return this.toDto(asset, null);

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

  async setAudioEnabled(orgId: string, id: string, audioEnabled: boolean) {
    const asset = await this.prisma.asset.findFirst({ where: { id, organizationId: orgId } });
    if (!asset) throw new NotFoundException('Asset not found');
    if (asset.type !== 'VIDEO' || !asset.hasAudioTrack) {
      throw new BadRequestException('Only videos with a detected audio track have an audio choice');
    }
    return this.toDto(await this.prisma.asset.update({ where: { id }, data: { audioEnabled } }), null);
  }

  async remove(orgId: string, id: string) {
    const asset = await this.prisma.asset.findFirst({ where: { id, organizationId: orgId } });
    if (!asset) throw new NotFoundException('Asset not found');

    // Check for playlist/screen/zone references *before* touching storage — Asset -> PlaylistItem
    // has no onDelete: Cascade (Screen.assetId/Zone.assetId are ON DELETE SET NULL, so those
    // wouldn't fail the delete outright, but silently orphaning a screen/zone that's actively
    // streaming this asset is exactly the footgun this check exists to prevent). Previously the
    // playlist check ran last, after the storage files were already deleted: the delete would
    // fail here, but the actual file was already gone, leaving a DB row with dead storageKey/
    // thumbnailKey references (a broken preview that a real refresh wouldn't fix, since the row
    // was never actually removed).
    // Count distinct playlists, not raw item rows — the same asset can appear more than once
    // within a single playlist, which would otherwise inflate this above the actual number of
    // playlists the "Remove it from those playlists" message below is telling the user to check.
    const [usedInPlaylists, screenCount, zoneCount] = await Promise.all([
      this.prisma.playlistItem.findMany({
        where: { assetId: id },
        select: { playlistId: true },
        distinct: ['playlistId'],
      }),
      this.prisma.screen.count({ where: { assetId: id } }),
      this.prisma.zone.count({ where: { assetId: id } }),
    ]);
    const usageCount = usedInPlaylists.length + screenCount + zoneCount;
    if (usageCount > 0) {
      throw new BadRequestException(
        `This asset is in use (${usageCount} reference${usageCount === 1 ? '' : 's'} across playlists, screens, or layout zones). Remove those references before deleting.`,
      );
    }

    // TEXT assets never had anything uploaded (see createText) — deleting their placeholder
    // storageKey would just be a wasted round-trip to the storage backend. Assets copied from
    // the library (see copyFromLibrary) share their storageKey/thumbnailKey with the library
    // original and every other org's copy — only delete the actual object once nothing else
    // still points at it, or every other copy silently loses its file underneath it.
    const otherRefs = await this.prisma.asset.count({ where: { storageKey: asset.storageKey, id: { not: id } } });
    if (asset.type !== 'TEXT' && otherRefs === 0) {
      await this.storage.delete(asset.storageKey);
      if (asset.thumbnailKey) await this.storage.delete(asset.thumbnailKey);
    }
    await this.prisma.asset.delete({ where: { id } });
  }

  private toDto(
    asset: { id: string; name: string; type: AssetType; mimeType: string; storageKey: string; thumbnailKey: string | null; sizeBytes: bigint; durationSecs: number | null; width: number | null; height: number | null; textContent: string | null; textFontFamily: string | null; textColor: string | null; textSize: TextSize | null; textBackgroundColor: string | null; hasAudioTrack: boolean; audioEnabled: boolean; status: string; category: AssetCategory; tags: string[]; organizationId: string | null; createdAt: Date },
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
      textContent: asset.textContent,
      textFontFamily: asset.textFontFamily,
      textColor: asset.textColor,
      textSize: asset.textSize,
      textBackgroundColor: asset.textBackgroundColor,
      hasAudioTrack: asset.hasAudioTrack,
      audioEnabled: asset.audioEnabled,
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
