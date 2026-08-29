import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { config as loadDotenv } from 'dotenv';
import { ConfigService } from '@nestjs/config';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import ffprobePath from '@ffprobe-installer/ffprobe';
import { PrismaService } from './prisma/prisma.service';
import { StorageService } from './storage/storage.service';

// One-off companion for the Phase 9A transcode fix (update_payer.md, 2026-08-28): re-encodes an
// already-READY VIDEO asset's *current* binary through the fixed pipeline (fps capped at 30,
// bitrate bounded) without needing the original pre-transcode upload, which processVideo() never
// retains a reference to once transcoding succeeds. Re-encoding the existing 1080p output at a
// lower frame rate is a normal, lossy-but-safe corrective step — not run automatically; call with
// one or more asset IDs.
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

ffmpeg.setFfmpegPath(ffmpegPath.path);
ffmpeg.setFfprobePath(ffprobePath.path);
for (const binPath of [ffmpegPath.path, ffprobePath.path]) {
  try { fs.chmodSync(binPath, 0o755); } catch { /* read-only fs or already correct */ }
}

function transcode(input: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions([
        '-crf 23',
        '-preset fast',
        '-movflags +faststart',
        '-vf scale=\'min(1920,iw)\':-2,fps=30',
        '-maxrate 8M',
        '-bufsize 16M',
        '-max_muxing_queue_size 1024',
      ])
      .output(output)
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });
}

function probeVideo(file: string): Promise<{ width: number; height: number; durationSecs: number; hasAudioTrack: boolean }> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(file, (err, meta) => {
      if (err) { reject(err instanceof Error ? err : new Error(String(err))); return; }
      const stream = meta.streams.find(s => s.codec_type === 'video');
      resolve({
        width: stream?.width ?? 0,
        height: stream?.height ?? 0,
        durationSecs: Math.round(meta.format.duration ?? 0),
        hasAudioTrack: meta.streams.some(s => s.codec_type === 'audio'),
      });
    });
  });
}

async function main() {
  const assetIds = process.argv.slice(2);
  if (assetIds.length === 0) {
    console.error('Usage: reprocess-video <assetId> [assetId...]');
    process.exitCode = 1;
    return;
  }

  const prisma = new PrismaService();
  const storage = new StorageService(new ConfigService(process.env));
  await prisma.$connect();
  let failures = 0;

  try {
    for (const assetId of assetIds) {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumina-reprocess-'));
      try {
        const asset = await prisma.asset.findUniqueOrThrow({ where: { id: assetId } });
        if (asset.type !== 'VIDEO') throw new Error(`asset ${assetId} is ${asset.type}, not VIDEO`);

        const inputPath = path.join(tmpDir, 'input.mp4');
        const outputPath = path.join(tmpDir, 'output.mp4');
        const raw = await storage.download(asset.storageKey);
        fs.writeFileSync(inputPath, raw);

        await transcode(inputPath, outputPath);
        const probe = await probeVideo(outputPath);
        const output = fs.readFileSync(outputPath);
        const sha256 = createHash('sha256').update(output).digest('hex');

        await storage.upload(asset.storageKey, output, 'video/mp4');
        await prisma.assetBinary.upsert({
          where: { assetId_kind_ordinal: { assetId, kind: 'PRIMARY', ordinal: 0 } },
          create: { assetId, kind: 'PRIMARY', ordinal: 0, storageKey: asset.storageKey, mimeType: 'video/mp4', sizeBytes: output.length, sha256 },
          update: { storageKey: asset.storageKey, mimeType: 'video/mp4', sizeBytes: output.length, sha256 },
        });
        await prisma.asset.update({
          where: { id: assetId },
          data: {
            sizeBytes: output.length,
            width: probe.width,
            height: probe.height,
            durationSecs: probe.durationSecs,
            hasAudioTrack: probe.hasAudioTrack,
          },
        });
        console.info(`[reprocess-video] complete asset=${assetId} oldBytes=${asset.sizeBytes} newBytes=${output.length}`);
      } catch (error) {
        failures++;
        console.error(`[reprocess-video] failed asset=${assetId}: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  } finally {
    await prisma.$disconnect();
  }

  if (failures > 0) {
    console.error(`[reprocess-video] completed with ${failures} failure(s)`);
    process.exitCode = 1;
  } else {
    console.info('[reprocess-video] completed successfully');
  }
}

void main();
