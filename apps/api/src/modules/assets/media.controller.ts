import { Controller, Get, Headers, NotFoundException, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { StorageService } from '../storage/storage.service';

// Deliberately unauthenticated: keys are unguessable (org id + random UUID), and this is the
// only way media is browser-reachable — S3_ENDPOINT points at an internal-only host (e.g. the
// `minio` container hostname in prod), so <img>/<video> tags can't hit S3 directly, and they
// can't send the dashboard's Bearer token either. See StorageService.getObject / publicUrl.
@Controller('media')
export class MediaController {
  constructor(private readonly storage: StorageService) {}

  @Get(':orgId/assets/:filename')
  serveAsset(
    @Param('orgId') orgId: string,
    @Param('filename') filename: string,
    @Headers('range') range: string | undefined,
    @Query('download') download: string | undefined,
    @Res() res: Response,
  ) {
    return this.serve(`${orgId}/assets/${filename}`, range, download, res, 'public, max-age=31536000, immutable');
  }

  // Screenshot keys (see StorageService.screenshotKey) live under a different prefix than
  // uploaded assets and were never given a route here, so screensApi's `screenshotUrl` always
  // 404'd — the dashboard's "live preview" img tag rendered a broken-image icon, never an
  // actual screenshot. Deliberately not cached like assets: the key is deterministic and
  // overwritten in place on every capture, not content-addressed, so a long-lived cache would
  // keep showing a stale frame after "Refresh now".
  @Get(':orgId/screenshots/:filename')
  serveScreenshot(
    @Param('orgId') orgId: string,
    @Param('filename') filename: string,
    @Res() res: Response,
  ) {
    return this.serve(`${orgId}/screenshots/${filename}`, undefined, undefined, res, 'no-store');
  }

  private async serve(
    key: string,
    range: string | undefined,
    download: string | undefined,
    res: Response,
    cacheControl: string,
  ) {
    let object;
    try {
      object = await this.storage.getObject(key, range);
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
      if (status === 404) throw new NotFoundException('File not found');
      throw err;
    }

    // Set only once the object is actually in hand — a decorator-level @Header() applies to
    // every response from the handler unconditionally, including a 500 from a transient storage
    // hiccup (e.g. MinIO taking a moment to accept new connections). An error response cached
    // `immutable` for a year turns a 30-second blip into a permanent-looking broken image/video
    // for every client (browser, CDN) that happened to request it during that window — exactly
    // what made the storage timeout fix insufficient on its own.
    res.setHeader('Cache-Control', cacheControl);
    res.status(object.statusCode);
    res.setHeader('Accept-Ranges', 'bytes');
    if (object.contentType) res.setHeader('Content-Type', object.contentType);
    if (object.contentLength != null) res.setHeader('Content-Length', String(object.contentLength));
    if (object.contentRange) res.setHeader('Content-Range', object.contentRange);
    if (download) {
      res.setHeader('Content-Disposition', `attachment; filename="${download.replace(/[\r\n"]/g, '')}"`);
    }
    object.body.pipe(res);
  }
}
