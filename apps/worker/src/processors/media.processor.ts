import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import ffprobePath from '@ffprobe-installer/ffprobe';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StorageService } from '../storage/storage.service';
import { PrismaService } from '../prisma/prisma.service';

const execFileAsync = promisify(execFile);

ffmpeg.setFfmpegPath(ffmpegPath.path);
ffmpeg.setFfprobePath(ffprobePath.path);

// pnpm's content-addressable store doesn't always preserve the executable bit on these
// platform binaries (seen with @ffprobe-installer/linux-x64: installed 0644) — when that
// happens probeVideo() below throws EACCES on every single video, which fails the whole job
// (including the thumbnail that had already been generated and uploaded) and leaves the
// asset stuck in ERROR with no thumbnailKey ever persisted.
for (const binPath of [ffmpegPath.path, ffprobePath.path]) {
  try {
    fs.chmodSync(binPath, 0o755);
  } catch {
    // read-only filesystem or already correct — nothing to do
  }
}

interface MediaJob {
  assetId: string;
  key: string;
  type: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'DOCUMENT';
  // Only meaningful (and only sent) for DOCUMENT — decides whether LibreOffice needs to convert
  // to PDF first, or pdftoppm can rasterize the upload directly.
  mimeType?: string;
}

// Dispatched by job name ('extract-audio'), not job.data.type like MediaJob above — this job
// creates/fills in a *new* AUDIO Asset row rather than updating the one at `assetId` in place,
// so it doesn't fit the generic IMAGE/VIDEO/DOCUMENT dispatch. `assetId` here is always the new
// AUDIO asset (already created with status PROCESSING by the API before this job was queued).
interface ExtractAudioJob {
  assetId: string;
  sourceKey: string;
  targetKey: string;
  // Set only when sourceKey is a throwaway raw-video upload with no Asset row of its own (the
  // "upload a video just for its audio" flow) — deleted once extraction finishes either way, so
  // it never lingers as an orphaned object. Absent when sourceKey belongs to an existing VIDEO
  // asset that must be left alone (the "convert this video to audio" flow).
  deleteSourceKey?: string;
}

// A pathological deck (or a mislabeled file) could otherwise blow up storage/DB with thousands of
// page rows — pages beyond this are silently dropped, not a hard failure.
const MAX_DOCUMENT_PAGES = 100;

@Processor('media')
export class MediaProcessor extends WorkerHost {
  private readonly logger = new Logger(MediaProcessor.name);

  constructor(
    private readonly storage: StorageService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job<MediaJob | ExtractAudioJob>) {
    if (job.name === 'extract-audio') {
      await this.processExtractAudio(job.data as ExtractAudioJob);
      return;
    }

    const { assetId, key, type, mimeType } = job.data as MediaJob;
    this.logger.log(`Processing ${type} asset ${assetId}`);

    try {
      if (type === 'IMAGE') {
        await this.processImage(assetId, key);
      } else if (type === 'VIDEO') {
        await this.processVideo(assetId, key);
      } else if (type === 'DOCUMENT') {
        await this.processDocument(assetId, key, mimeType ?? 'application/pdf');
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

    // fit: 'inside' (not 'cover') so a tall/portrait source is never cropped to fit this
    // landscape-ish bounding box — it's scaled down to fit within it, preserving the full frame,
    // with the actual output dimensions varying per source aspect ratio (e.g. a 300x700 source
    // comes out ~257x600, not force-cropped to exactly 480x600). withoutEnlargement so a small
    // source thumbnail isn't upscaled/blurred past its native size.
    const thumbnail = await sharp(original)
      .resize(480, 600, { fit: 'inside', withoutEnlargement: true })
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
          hasAudioTrack: probe.hasAudioTrack,
        },
      });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // Strips the video stream out of a source file and re-encodes just the audio to AAC/M4A,
  // uploading it as the *new* AUDIO asset's own file — unlike processVideo() above, this never
  // touches the source asset's row, only the freshly-created one at `assetId`.
  private async processExtractAudio(data: ExtractAudioJob) {
    const { assetId, sourceKey, targetKey, deleteSourceKey } = data;
    this.logger.log(`Extracting audio for asset ${assetId} from ${sourceKey}`);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumina-audio-'));
    const inputPath = path.join(tmpDir, 'input' + path.extname(sourceKey));
    const outputPath = path.join(tmpDir, 'output.m4a');

    try {
      const raw = await this.storage.download(sourceKey);
      fs.writeFileSync(inputPath, raw);

      await this.extractAudioTrack(inputPath, outputPath);
      const durationSecs = await this.probeAudioDuration(outputPath);
      const output = fs.readFileSync(outputPath);

      await this.storage.upload(targetKey, output, 'audio/mp4');

      await this.prisma.asset.update({
        where: { id: assetId },
        data: { sizeBytes: output.length, durationSecs, status: 'READY' },
      });
    } catch (err) {
      this.logger.error(`Failed to extract audio for asset ${assetId}`, err);
      await this.prisma.asset.update({ where: { id: assetId }, data: { status: 'ERROR' } });
      throw err;
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      // Best-effort — a leftover tmp/ object is harmless clutter, not worth failing the job over.
      if (deleteSourceKey) {
        await this.storage.delete(deleteSourceKey).catch(err => this.logger.warn(`Failed to clean up tmp source ${deleteSourceKey}`, err));
      }
    }
  }

  private extractAudioTrack(input: string, output: string): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(input)
        .noVideo()
        .audioCodec('aac')
        .audioBitrate('192k')
        .output(output)
        .on('end', () => resolve())
        .on('error', reject)
        .run();
    });
  }

  private probeAudioDuration(file: string): Promise<number> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(file, (err, meta) => {
        if (err) { reject(err instanceof Error ? err : new Error(String(err))); return; }
        resolve(Math.round(meta.format.duration ?? 0));
      });
    });
  }

  // PDF/PPT/PPTX/DOC/DOCX → one webp image per page. Office formats go through LibreOffice
  // headless to PDF first, since pdftoppm (poppler) only understands PDF.
  private async processDocument(assetId: string, key: string, mimeType: string) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumina-doc-'));

    try {
      const raw = await this.storage.download(key);
      const inputPath = path.join(tmpDir, 'input' + path.extname(key));
      fs.writeFileSync(inputPath, raw);

      const pdfPath = mimeType === 'application/pdf'
        ? inputPath
        : await this.convertToPdf(inputPath, tmpDir);

      const pagePaths = await this.rasterizePdf(pdfPath, tmpDir);
      if (pagePaths.length === 0) {
        throw new Error('Document conversion produced no pages');
      }

      let width: number | undefined;
      let height: number | undefined;
      for (let i = 0; i < pagePaths.length; i++) {
        const page = i + 1;
        const { data, info } = await sharp(pagePaths[i])
          .webp({ quality: 80 })
          .toBuffer({ resolveWithObject: true });
        if (page === 1) {
          width = info.width;
          height = info.height;
        }
        await this.storage.upload(this.documentPageKey(key, page), data, 'image/webp');
      }

      await this.prisma.asset.update({
        where: { id: assetId },
        data: { thumbnailKey: this.documentPageKey(key, 1), pageCount: pagePaths.length, width, height },
      });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // Mirrors the `_thumb.webp`/`_transcoded.mp4` sibling-key convention above, one key per page
  // (1-indexed) — shared with the API's player/playlist hydration, which reconstructs these same
  // keys from `storageKey` + `pageCount` to build the URLs the player actually loads.
  private documentPageKey(key: string, page: number): string {
    return key.replace(/(\.[^.]+)$/, `_p${page}.webp`);
  }

  private async convertToPdf(inputPath: string, tmpDir: string): Promise<string> {
    const profileDir = path.join(tmpDir, 'lo_profile');
    // -env:UserInstallation isolates each job's LibreOffice profile — without it, concurrent
    // conversions in the same container can collide on a shared profile lock.
    await execFileAsync('soffice', [
      '--headless',
      `-env:UserInstallation=file://${profileDir}`,
      '--convert-to', 'pdf',
      '--outdir', tmpDir,
      inputPath,
    ], { timeout: 120_000 });

    const pdfPath = path.join(tmpDir, `${path.basename(inputPath, path.extname(inputPath))}.pdf`);
    if (!fs.existsSync(pdfPath)) {
      throw new Error('LibreOffice conversion did not produce a PDF');
    }
    return pdfPath;
  }

  private async rasterizePdf(pdfPath: string, tmpDir: string): Promise<string[]> {
    const prefix = path.join(tmpDir, 'page');
    await execFileAsync('pdftoppm', ['-r', '150', '-png', pdfPath, prefix], { timeout: 180_000 });

    // pdftoppm zero-pads the page number once a document has 10+ pages (page-1.png vs
    // page-01.png), so pages are matched and sorted numerically rather than lexically.
    const pageRe = /^page-(\d+)\.png$/;
    const pages = fs.readdirSync(tmpDir)
      .map(name => {
        const m = pageRe.exec(name);
        return m ? { name, n: Number(m[1]) } : null;
      })
      .filter((p): p is { name: string; n: number } => p !== null)
      .sort((a, b) => a.n - b.n);

    if (pages.length > MAX_DOCUMENT_PAGES) {
      this.logger.warn(`${pdfPath} has ${pages.length} pages — truncating to ${MAX_DOCUMENT_PAGES}`);
    }
    return pages.slice(0, MAX_DOCUMENT_PAGES).map(p => path.join(tmpDir, p.name));
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

  private probeVideo(file: string): Promise<{ width: number; height: number; durationSecs: number; hasAudioTrack: boolean }> {
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
}
