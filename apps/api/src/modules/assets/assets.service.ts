import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AssetType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

const ALLOWED_MIME: Record<string, AssetType> = {
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
        const url = await this.storage.signedUrl(a.storageKey);
        const thumbUrl = a.thumbnailKey ? await this.storage.signedUrl(a.thumbnailKey) : null;
        return this.toDto(a, url, thumbUrl);
      }),
    );
  }

  async findOne(orgId: string, id: string) {
    const asset = await this.prisma.asset.findFirst({ where: { id, organizationId: orgId } });
    if (!asset) throw new NotFoundException('Asset not found');

    const url = await this.storage.signedUrl(asset.storageKey);
    const thumbUrl = asset.thumbnailKey ? await this.storage.signedUrl(asset.thumbnailKey) : null;
    return this.toDto(asset, url, thumbUrl);
  }

  async remove(orgId: string, id: string) {
    const asset = await this.prisma.asset.findFirst({ where: { id, organizationId: orgId } });
    if (!asset) throw new NotFoundException('Asset not found');

    await this.storage.delete(asset.storageKey);
    if (asset.thumbnailKey) await this.storage.delete(asset.thumbnailKey);
    await this.prisma.asset.delete({ where: { id } });
  }

  private toDto(
    asset: { id: string; name: string; type: AssetType; mimeType: string; storageKey: string; thumbnailKey: string | null; sizeBytes: bigint; durationSecs: number | null; width: number | null; height: number | null; status: string; organizationId: string; createdAt: Date },
    signedUrl: string | null,
    thumbUrl?: string | null,
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
      url: signedUrl,
      thumbnailUrl: thumbUrl ?? null,
      organizationId: asset.organizationId,
      createdAt: asset.createdAt.toISOString(),
    };
  }
}
