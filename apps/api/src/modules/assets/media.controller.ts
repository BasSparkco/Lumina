import { Controller, Get, Header, Headers, NotFoundException, Param, Query, Res } from '@nestjs/common';
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
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  async serve(
    @Param('orgId') orgId: string,
    @Param('filename') filename: string,
    @Headers('range') range: string | undefined,
    @Query('download') download: string | undefined,
    @Res() res: Response,
  ) {
    const key = `${orgId}/assets/${filename}`;
    let object;
    try {
      object = await this.storage.getObject(key, range);
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
      if (status === 404) throw new NotFoundException('File not found');
      throw err;
    }

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
