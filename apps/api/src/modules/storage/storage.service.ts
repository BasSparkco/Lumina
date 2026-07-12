import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import type { Readable } from 'stream';

export interface MediaObject {
  body: Readable;
  contentType?: string;
  contentLength?: number;
  contentRange?: string;
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
}
