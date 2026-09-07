import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import type { Readable } from 'stream';
import { MediaTokenService } from './media-token.service';

// P4 TTL policy (docs/tenant_isolation_and_platform_admin_plan.md §P4 tasks 6/8) — how long a
// minted media URL stays valid before MediaController rejects it:
//   - SCREENSHOT: shortest. Operationally sensitive (a live view of the screen) and the object is
//     overwritten in place on every capture, so there's no "immutable content" argument for a
//     longer TTL the way there is for assets.
//   - DASHBOARD_ASSET: bounds a browsing session. The dashboard re-mints URLs on every list/detail
//     fetch, so this only matters if a tab is left open unusually long — an expired thumbnail on a
//     stale tab is an acceptable, self-healing (reload) trade-off for not handing out a
//     long-lived bearer link.
//   - MANIFEST_ASSET: long-bounded, not short. apps/player's media-download-manager.ts caches
//     content by immutable identity (assetId/binaryId/sha256), never by URL (task 7), but an
//     already-in-flight download's retries reuse the exact URL it started with rather than
//     pulling a fresh one from the next manifest poll — and a single large-file attempt is
//     allowed up to a 4h timeout with its own retry backoff on top. This TTL has to safely outlive
//     that worst case; the security win over the previous permanent, unauthenticated URL is still
//     substantial (resource-scoped, revocable by rotating JWT_SECRET, bounded at all).
const MEDIA_TOKEN_TTL_SEC = {
  SCREENSHOT: 5 * 60,
  DASHBOARD_ASSET: 60 * 60,
  MANIFEST_ASSET: 24 * 60 * 60,
} as const;

export interface MediaObject {
  body: Readable;
  contentType?: string;
  contentLength?: number;
  contentRange?: string;
  etag?: string;
  lastModified?: Date;
  statusCode: number;
}

@Injectable()
export class StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly cdnBase: string;

  constructor(config: ConfigService, private readonly mediaTokens: MediaTokenService) {
    this.bucket = config.getOrThrow<string>('S3_BUCKET');
    this.cdnBase = config.getOrThrow<string>('CDN_BASE_URL');
    this.client = new S3Client({
      endpoint: config.get<string>('S3_ENDPOINT'),
      region: config.get<string>('S3_REGION') ?? 'us-east-1',
      credentials: {
        accessKeyId: config.getOrThrow<string>('S3_ACCESS_KEY'),
        secretAccessKey: config.getOrThrow<string>('S3_SECRET_KEY'),
      },
      forcePathStyle: true, // required for MinIO
      // Without these, a stalled connection (e.g. MinIO restarting while this
      // client holds a stale pooled keep-alive socket) hangs the SDK call
      // forever instead of failing fast — seen in prod as multi-minute hangs
      // on both uploads and media GETs. connectionTimeout bounds establishing
      // the TCP connection; socketTimeout aborts on inactivity (not total
      // duration, so it won't cut off a slow-but-progressing large upload/
      // download — only a truly stalled one).
      //
      // maxSockets: @smithy/node-http-handler hardcodes a pool of 50 keep-alive sockets to the
      // S3/MinIO endpoint when this isn't set. Every image/video request the media controller
      // serves goes through this one client, and a video's Range-request streaming holds its
      // socket open for the duration of playback — so 50 was nowhere near enough concurrent
      // capacity for a signage deployment with more than a handful of screens/dashboard users
      // active at once. Once the pool filled, every further request queued behind it and hit
      // connectionTimeout waiting for a socket to free up — indistinguishable from MinIO itself
      // being unreachable (same TimeoutError, same message), but MinIO was up and answering raw
      // TCP connects instantly the whole time. Confirmed in prod: 76 of 305 requests (25%) failed
      // this way over ~5 hours under normal traffic. Local MinIO connections are cheap, so there's
      // no real downside to a much larger pool here.
      requestHandler: new NodeHttpHandler({
        connectionTimeout: 5_000,
        socketTimeout: 30_000,
        httpAgent: { maxSockets: 500 },
        httpsAgent: { maxSockets: 500 },
      }),
    });
  }

  async upload(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  /**
   * Streams an object directly from the internal S3 endpoint (never returns a URL) — used to
   * serve media publicly through the API itself, since S3_ENDPOINT is only reachable from
   * inside the deployment network (e.g. the `minio` container hostname in prod) and a signed
   * URL built from it can never be fetched by a browser.
   */
  async getObject(key: string, range?: string): Promise<MediaObject> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key, ...(range && { Range: range }) }),
    );
    return {
      body: res.Body as Readable,
      contentType: res.ContentType,
      contentLength: res.ContentLength,
      contentRange: res.ContentRange,
      etag: res.ETag,
      lastModified: res.LastModified,
      statusCode: res.ContentRange ? 206 : 200,
    };
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  // Deterministic, overwritten in place on every upload — a screen's screenshot is a single
  // "latest" live preview, not a history, so both the uploader (PlayerService) and the reader
  // (MediaController) need to agree on the same key without either owning the other.
  screenshotKey(orgId: string, screenId: string): string {
    return `${orgId}/screenshots/${screenId}.jpg`;
  }

  // Reconstructs the derived page-image key media.processor.ts uploaded during DOCUMENT
  // conversion (1-indexed `_p${n}.webp` sibling of the asset's own storageKey).
  documentPageKey(storageKey: string, page: number): string {
    return storageKey.replace(/(\.[^.]+)$/, `_p${page}.webp`);
  }

  private mediaUrl(path: string, token: string, download?: string): string {
    const params = new URLSearchParams({ token });
    if (download) params.set('download', download);
    return `${this.cdnBase}/${path}?${params.toString()}`;
  }

  // P4 (docs/tenant_isolation_and_platform_admin_plan.md §P4) — every URL below resolves through
  // MediaController by database identity (never a client-suppliable org id + filename) and is
  // authorized by a short-lived signed token instead of the storage key itself being the secret.
  // Callers pass the *database id* they already have in hand (an Asset/AssetBinary/Screen row),
  // never a raw storageKey — the whole point is that nothing outside this service and
  // MediaController ever needs to know or handle a real storage key again.

  assetUrl(assetId: string, download?: string): string {
    return this.mediaUrl(`assets/${assetId}`, this.mediaTokens.sign('asset', assetId, MEDIA_TOKEN_TTL_SEC.DASHBOARD_ASSET), download);
  }

  assetThumbnailUrl(assetId: string): string {
    return this.mediaUrl(`assets/${assetId}/thumbnail`, this.mediaTokens.sign('asset-thumb', assetId, MEDIA_TOKEN_TTL_SEC.DASHBOARD_ASSET));
  }

  assetPageUrl(assetId: string, page: number): string {
    return this.mediaUrl(`assets/${assetId}/pages/${page}`, this.mediaTokens.sign('asset-page', assetId, MEDIA_TOKEN_TTL_SEC.DASHBOARD_ASSET, page));
  }

  assetPageUrls(assetId: string, pageCount: number | null): string[] {
    return Array.from({ length: pageCount ?? 0 }, (_, i) => this.assetPageUrl(assetId, i + 1));
  }

  // Manifest-embedded only (PlayerService's offline-integrity builder) — see MEDIA_TOKEN_TTL_SEC
  // above for why this TTL is much longer than the dashboard-facing URLs above.
  assetBinaryUrl(binaryId: string): string {
    return this.mediaUrl(`binaries/${binaryId}`, this.mediaTokens.sign('binary', binaryId, MEDIA_TOKEN_TTL_SEC.MANIFEST_ASSET));
  }

  screenshotUrl(screenId: string): string {
    return this.mediaUrl(`screens/${screenId}/screenshot`, this.mediaTokens.sign('screenshot', screenId, MEDIA_TOKEN_TTL_SEC.SCREENSHOT));
  }
}
