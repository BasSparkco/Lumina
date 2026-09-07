import { Controller, Get, Headers, Logger, NotFoundException, Param, ParseIntPipe, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { StorageService } from '../storage/storage.service';
import { MediaTokenService } from '../storage/media-token.service';
import { PrismaService } from '../../prisma/prisma.service';

// P4 (docs/tenant_isolation_and_platform_admin_plan.md §P4) — every route below resolves a
// storage key by database identity (assetId/binaryId/screenId) rather than trusting a
// client-suppliable org id + filename, and requires a short-lived signed `?token=` capability
// minted by StorageService (see media-token.service.ts) instead of the storage key itself being
// an unguessable-but-permanent secret. Deliberately still unauthenticated in the JwtAuthGuard
// sense — an <img>/<video> tag can't send a Bearer header — the token *is* the authorization
// decision, frozen at mint time by whichever caller already ran a real ownership/visibility
// check (asset listing, manifest build, screenshot lookup).
//
// The legacy `:orgId/assets/:filename` / `:orgId/screenshots/:filename` routes below these are
// kept running deliberately (P9's rollout plan §9 step 6: "both URL formats temporarily
// understood internally") — every URL-minting call site has moved to the routes above, so no
// code path issues a legacy-shaped URL anymore, but the routes themselves aren't pulled until a
// fleet-refresh threshold confirms no cached/offline client still holds one (P4 task 10).
@Controller('media')
export class MediaController {
  private readonly logger = new Logger(MediaController.name);

  constructor(
    private readonly storage: StorageService,
    private readonly mediaTokens: MediaTokenService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('assets/:assetId')
  async serveAssetFile(
    @Param('assetId') assetId: string,
    @Query('token') token: string | undefined,
    @Query('download') download: string | undefined,
    @Headers('range') range: string | undefined,
    @Res() res: Response,
  ) {
    this.mediaTokens.verify(token, 'asset', assetId);
    const asset = await this.prisma.asset.findUnique({ where: { id: assetId }, select: { storageKey: true } });
    if (!asset) throw new NotFoundException('File not found');
    return this.serve(asset.storageKey, range, download, res, this.immutableCacheControl());
  }

  @Get('assets/:assetId/thumbnail')
  async serveAssetThumbnail(
    @Param('assetId') assetId: string,
    @Query('token') token: string | undefined,
    @Res() res: Response,
  ) {
    this.mediaTokens.verify(token, 'asset-thumb', assetId);
    const asset = await this.prisma.asset.findUnique({ where: { id: assetId }, select: { thumbnailKey: true } });
    if (!asset?.thumbnailKey) throw new NotFoundException('File not found');
    return this.serve(asset.thumbnailKey, undefined, undefined, res, this.immutableCacheControl());
  }

  @Get('assets/:assetId/pages/:page')
  async serveAssetPage(
    @Param('assetId') assetId: string,
    @Param('page', ParseIntPipe) page: number,
    @Query('token') token: string | undefined,
    @Res() res: Response,
  ) {
    this.mediaTokens.verify(token, 'asset-page', assetId, page);
    const asset = await this.prisma.asset.findUnique({ where: { id: assetId }, select: { storageKey: true, pageCount: true } });
    if (!asset || page < 1 || page > (asset.pageCount ?? 0)) throw new NotFoundException('File not found');
    return this.serve(this.storage.documentPageKey(asset.storageKey, page), undefined, undefined, res, this.immutableCacheControl());
  }

  @Get('binaries/:binaryId')
  async serveBinary(
    @Param('binaryId') binaryId: string,
    @Query('token') token: string | undefined,
    @Headers('range') range: string | undefined,
    @Res() res: Response,
  ) {
    this.mediaTokens.verify(token, 'binary', binaryId);
    const binary = await this.prisma.assetBinary.findUnique({ where: { id: binaryId }, select: { storageKey: true } });
    if (!binary) throw new NotFoundException('File not found');
    return this.serve(binary.storageKey, range, undefined, res, this.immutableCacheControl());
  }

  // Deliberately not cached like assets (see serve() below): the key is deterministic and
  // overwritten in place on every capture, not content-addressed, so a long-lived cache would
  // keep showing a stale frame after "Refresh now".
  @Get('screens/:screenId/screenshot')
  async serveScreenScreenshot(
    @Param('screenId') screenId: string,
    @Query('token') token: string | undefined,
    @Res() res: Response,
  ) {
    this.mediaTokens.verify(token, 'screenshot', screenId);
    const screen = await this.prisma.screen.findUnique({
      where: { id: screenId },
      select: { organizationId: true, screenshotUpdatedAt: true },
    });
    if (!screen?.organizationId || !screen.screenshotUpdatedAt) throw new NotFoundException('File not found');
    return this.serve(this.storage.screenshotKey(screen.organizationId, screenId), undefined, undefined, res, 'private, no-store');
  }

  // A signed URL is still a bearer credential for its TTL — max-age is bounded to the token's own
  // lifetime (rather than a flat year) so a cache never outlives the authorization it was issued
  // under, and `private` keeps a shared/CDN cache from retaining a capability URL on another
  // client's behalf (P4 task 8). Content itself is genuinely immutable (content-addressed via
  // sha256/derived-from-source), so re-fetching the *same* already-authorized URL within that
  // window from the browser's own cache is harmless.
  private immutableCacheControl(): string {
    return 'private, max-age=3600, immutable';
  }

  @Get(':orgId/assets/:filename')
  serveAsset(
    @Param('orgId') orgId: string,
    @Param('filename') filename: string,
    @Headers('range') range: string | undefined,
    @Query('download') download: string | undefined,
    @Res() res: Response,
  ) {
    // P4 task 10 — nothing mints this URL shape anymore; this warning is the fleet-refresh signal
    // the plan's rollout step 8 asks for before the route is actually removed.
    this.logger.warn(`Legacy unauthenticated media route hit: assets/${orgId}/${filename}`);
    return this.serve(`${orgId}/assets/${filename}`, range, download, res, 'public, max-age=31536000, immutable');
  }

  @Get(':orgId/screenshots/:filename')
  serveScreenshot(
    @Param('orgId') orgId: string,
    @Param('filename') filename: string,
    @Res() res: Response,
  ) {
    this.logger.warn(`Legacy unauthenticated media route hit: screenshots/${orgId}/${filename}`);
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
    // A signed URL's token is effectively a bearer credential embedded in the URL — never let it
    // leak to a third party (or even Lumina's own analytics) via the Referer header on whatever
    // follow-up request rendering this media triggers (P4 task 8).
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.status(object.statusCode);
    res.setHeader('Accept-Ranges', 'bytes');
    if (object.contentType) res.setHeader('Content-Type', object.contentType);
    if (object.contentLength != null) res.setHeader('Content-Length', String(object.contentLength));
    if (object.contentRange) res.setHeader('Content-Range', object.contentRange);
    if (object.etag) res.setHeader('ETag', object.etag);
    if (object.lastModified) res.setHeader('Last-Modified', object.lastModified.toUTCString());
    if (download) {
      res.setHeader('Content-Disposition', `attachment; filename="${download.replace(/[\r\n"]/g, '')}"`);
    }
    object.body.pipe(res);
  }
}
