import path from 'node:path';
import { createHash } from 'node:crypto';
import { config as loadDotenv } from 'dotenv';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from './prisma/prisma.service';
import { StorageService } from './storage/storage.service';

// One-time migration companion for AssetBinary. New jobs write integrity metadata as part of
// processing; this command covers READY objects created before that code existed. It processes
// sequentially to keep peak memory bounded to one media object (StorageService currently exposes
// downloads as Buffer), and is intentionally never run automatically during container startup.
loadDotenv({
  path: [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '..', '.env'),
    path.resolve(process.cwd(), '..', '..', '.env'),
    path.resolve(process.cwd(), 'apps', 'api', '.env'),
    path.resolve(process.cwd(), 'apps', 'worker', '.env'),
  ],
  quiet: true,
});

async function main() {
  const prisma = new PrismaService();
  const storage = new StorageService(new ConfigService(process.env));
  await prisma.$connect();
  let failures = 0;

  try {
    const assets = await prisma.asset.findMany({
      where: { status: 'READY', type: { in: ['IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT'] } },
      orderBy: { id: 'asc' },
    });
    console.info(`[asset-integrity-backfill] found ${assets.length} READY binary assets`);

    for (const asset of assets) {
      try {
        if (asset.type === 'DOCUMENT') {
          await prisma.assetBinary.deleteMany({ where: { assetId: asset.id, kind: 'DOCUMENT_PAGE' } });
          for (let page = 1; page <= (asset.pageCount ?? 0); page++) {
            const storageKey = documentPageKey(asset.storageKey, page);
            const bytes = await storage.download(storageKey);
            await upsertBinary(prisma, asset.id, 'DOCUMENT_PAGE', page, storageKey, 'image/webp', bytes);
          }
          if (!asset.pageCount) throw new Error('READY document has no rasterized pages');
        } else {
          const bytes = await storage.download(asset.storageKey);
          const finalMimeType = asset.type === 'VIDEO' ? 'video/mp4' : asset.mimeType;
          await upsertBinary(prisma, asset.id, 'PRIMARY', 0, asset.storageKey, finalMimeType, bytes);
          // Corrects the historical video bug where sizeBytes retained the original upload size
          // after storageKey switched to the final transcoded MP4.
          if (asset.sizeBytes !== BigInt(bytes.length) || asset.mimeType !== finalMimeType) {
            await prisma.asset.update({
              where: { id: asset.id },
              data: { sizeBytes: bytes.length, mimeType: finalMimeType },
            });
          }
        }
        console.info(`[asset-integrity-backfill] complete asset=${asset.id} type=${asset.type}`);
      } catch (error) {
        failures++;
        console.error(
          `[asset-integrity-backfill] failed asset=${asset.id} type=${asset.type}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  } finally {
    await prisma.$disconnect();
  }

  if (failures > 0) {
    console.error(`[asset-integrity-backfill] completed with ${failures} failure(s)`);
    process.exitCode = 1;
  } else {
    console.info('[asset-integrity-backfill] completed successfully');
  }
}

async function upsertBinary(
  prisma: PrismaService,
  assetId: string,
  kind: 'PRIMARY' | 'DOCUMENT_PAGE',
  ordinal: number,
  storageKey: string,
  mimeType: string,
  bytes: Buffer,
) {
  const integrity = {
    storageKey,
    mimeType,
    sizeBytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  await prisma.assetBinary.upsert({
    where: { assetId_kind_ordinal: { assetId, kind, ordinal } },
    create: { assetId, kind, ordinal, ...integrity },
    update: integrity,
  });
}

function documentPageKey(storageKey: string, page: number): string {
  return storageKey.replace(/(\.[^.]+)$/, `_p${page}.webp`);
}

void main();
