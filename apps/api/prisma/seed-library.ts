import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@lumina/db';
import { PrismaPg } from '@prisma/adapter-pg';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { Queue } from 'bullmq';
import { ALLOWED_MIME } from '../src/modules/assets/assets.service';

// Developer-facing stock asset library loader.
//
// Drop image/video/audio files into prisma/library-assets/<CATEGORY>/, one folder per
// AssetCategory value (see schema.prisma), then run `pnpm --filter api db:seed-library`.
// Each file is uploaded to storage and inserted as an Asset row with organizationId: null —
// the same "system row, orgs copy it to use it" pattern as THEME_PRESETS in theme-presets.ts.
// Thumbnail/transcode processing is queued through the same BullMQ 'media' job the upload
// endpoint uses, so library assets get identical treatment (resized thumbnail, video transcode)
// from apps/worker's existing MediaProcessor — nothing asset-library-specific to maintain there.

const LIBRARY_DIR = path.join(__dirname, 'library-assets');

const CATEGORY_FOLDERS = ['BACKGROUND', 'ICON', 'ILLUSTRATION', 'STOCK_PHOTO', 'LOGO', 'VIDEO_LOOP', 'AUDIO_JINGLE', 'GENERIC'] as const;

const EXTENSION_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
};

function humanize(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, '');
  return base.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function tagsFromFilename(filename: string): string[] {
  const base = filename.replace(/\.[^.]+$/, '');
  return [...new Set(base.toLowerCase().split(/[-_\s]+/).filter(Boolean))];
}

async function main() {
  if (!fs.existsSync(LIBRARY_DIR)) {
    console.log(`No ${LIBRARY_DIR} directory found — nothing to seed. Create prisma/library-assets/<CATEGORY>/ and add files to grow the stock library.`);
    return;
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const s3 = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? 'us-east-1',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY ?? '',
      secretAccessKey: process.env.S3_SECRET_KEY ?? '',
    },
    forcePathStyle: true,
  });
  const bucket = process.env.S3_BUCKET ?? 'lumina-media';
  const mediaQueue = new Queue('media', { connection: { url: process.env.REDIS_URL ?? 'redis://localhost:6381' } });

  let created = 0;
  let skipped = 0;

  for (const category of CATEGORY_FOLDERS) {
    const dir = path.join(LIBRARY_DIR, category);
    if (!fs.existsSync(dir)) continue;

    for (const filename of fs.readdirSync(dir)) {
      const ext = path.extname(filename).toLowerCase();
      const mimeType = EXTENSION_MIME[ext];
      const assetType = mimeType ? ALLOWED_MIME[mimeType] : undefined;
      if (!mimeType || !assetType) {
        console.warn(`Skipping ${category}/${filename}: unsupported extension "${ext}"`);
        continue;
      }

      const name = humanize(filename);
      const existing = await prisma.asset.findFirst({ where: { organizationId: null, name, category } });
      if (existing) { skipped++; continue; }

      const filePath = path.join(dir, filename);
      const buffer = fs.readFileSync(filePath);
      const key = `system/assets/${crypto.randomUUID()}.${ext.slice(1)}`;

      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: mimeType }));

      const asset = await prisma.asset.create({
        data: {
          name,
          type: assetType,
          mimeType,
          storageKey: key,
          sizeBytes: buffer.length,
          category,
          tags: tagsFromFilename(filename),
          organizationId: null,
          status: 'PROCESSING',
        },
      });

      await mediaQueue.add('generate-thumbnail', { assetId: asset.id, key, type: assetType });
      created++;
      console.log(`Queued ${category}/${filename} -> asset ${asset.id}`);
    }
  }

  console.log(`Library seed complete. Created ${created}, skipped ${skipped} already-seeded. Thumbnails/transcodes will finish asynchronously — make sure apps/worker is running.`);

  await mediaQueue.close();
  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
