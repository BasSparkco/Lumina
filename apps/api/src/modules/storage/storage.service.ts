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

  constructor(config: ConfigService) {
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

  publicUrl(key: string, downloadFilename?: string): string {
    const url = `${this.cdnBase}/${key}`;
    return downloadFilename ? `${url}?download=${encodeURIComponent(downloadFilename)}` : url;
  }

  // Deterministic, overwritten in place on every upload — a screen's screenshot is a single
  // "latest" live preview, not a history, so both the uploader (PlayerService) and the reader
  // (ScreensService) need to agree on the same key without either owning the other.
  screenshotKey(orgId: string, screenId: string): string {
    return `${orgId}/screenshots/${screenId}.jpg`;
  }
}
