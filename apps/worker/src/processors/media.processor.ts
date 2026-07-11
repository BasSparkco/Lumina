import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import ffprobePath from '@ffprobe-installer/ffprobe';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StorageService } from '../storage/storage.service';
import { PrismaService } from '../prisma/prisma.service';

ffmpeg.setFfmpegPath(ffmpegPath.path);
ffmpeg.setFfprobePath(ffprobePath.path);

interface MediaJob {
  assetId: string;
  key: string;
  type: 'IMAGE' | 'VIDEO' | 'AUDIO';
}

@Processor('media')
export class MediaProcessor extends WorkerHost {
  private readonly logger = new Logger(MediaProcessor.name);

  constructor(
    private readonly storage: StorageService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job<MediaJob>) {
    const { assetId, key, type } = job.data;
    this.logger.log(`Processing ${type} asset ${assetId}`);

    try {
      if (type === 'IMAGE') {
        await this.processImage(assetId, key);
      } else if (type === 'VIDEO') {
        await this.processVideo(assetId, key);
      }
      // AUDIO: just mark ready — no thumbnail needed

      await this.prisma.asset.update({
        where: { id: assetId },
        data: { status: 'READY' },
      });
    } catch (err) {
      this.logger.error(`Failed to process asset ${assetId}`, err);
      await this.prisma.asset.update({
        where: { id: assetId },
        data: { status: 'ERROR' },
      });
      throw err;
    }
  }

  private async processImage(assetId: string, key: string) {
    const original = await this.storage.download(key);

    const thumbnail = await sharp(original)
      .resize(400, 300, { fit: 'cover' })
      .webp({ quality: 80 })
      .toBuffer();

    const thumbKey = key.replace(/(\.[^.]+)$/, '_thumb.webp');
    await this.storage.upload(thumbKey, thumbnail, 'image/webp');

    const meta = await sharp(original).metadata();

    await this.prisma.asset.update({
      where: { id: assetId },
      data: { thumbnailKey: thumbKey, width: meta.width, height: meta.height },
    });
  }

  private async processVideo(assetId: string, key: string) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumina-'));
    const inputPath = path.join(tmpDir, 'input' + path.extname(key));
    const transcodedPath = path.join(tmpDir, 'output.mp4');
    const thumbPath = path.join(tmpDir, 'thumb.webp');

    try {
      const raw = await this.storage.download(key);
      fs.writeFileSync(inputPath, raw);

      // Transcode to H.264/AAC MP4, max 1080p, web-optimized (faststart)
      await this.transcode(inputPath, transcodedPath);

      // Extract thumbnail from 1s mark
      await this.extractFrame(inputPath, thumbPath);

      const transcodedKey = key.replace(/(\.[^.]+)$/, '_transcoded.mp4');
      const thumbKey = key.replace(/(\.[^.]+)$/, '_thumb.webp');

      await this.storage.upload(transcodedKey, fs.readFileSync(transcodedPath), 'video/mp4');
      await this.storage.upload(thumbKey, fs.readFileSync(thumbPath), 'image/webp');

      // Probe dimensions from the transcoded file
      const probe = await this.probeVideo(transcodedPath);

      await this.prisma.asset.update({
        where: { id: assetId },
        data: {
          storageKey: transcodedKey,
          thumbnailKey: thumbKey,
          width: probe.width,
          height: probe.height,
          durationSecs: probe.durationSecs,
        },
      });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  private transcode(input: string, output: string): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(input)
        .videoCodec('libx264')
        .audioCodec('aac')
        .outputOptions([
          '-crf 23',
          '-preset fast',
          '-movflags +faststart',
          '-vf scale=\'min(1920,iw)\':-2',
          '-max_muxing_queue_size 1024',
        ])
        .output(output)
        .on('end', () => resolve())
        .on('error', reject)
        .run();
    });
  }

  private extractFrame(input: string, output: string): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(input)
        .seekInput(1)
        .frames(1)
        .outputOptions(['-vf scale=400:300:force_original_aspect_ratio=increase,crop=400:300'])
        .output(output)
        .on('end', () => resolve())
        .on('error', reject)
        .run();
    });
  }

  private probeVideo(file: string): Promise<{ width: number; height: number; durationSecs: number }> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(file, (err, meta) => {
        if (err) { reject(err); return; }
        const stream = meta.streams.find(s => s.codec_type === 'video');
        resolve({
          width: stream?.width ?? 0,
          height: stream?.height ?? 0,
          durationSecs: Math.round(meta.format.duration ?? 0),
        });
      });
    });
  }
}
