import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import DOMPurify from 'isomorphic-dompurify';
import type { AssetCategory, AssetType, TextSize, TickerDirection } from '@lumina/db';
import { DEFAULT_FONT_ID } from '@lumina/types';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { OrgScopedService } from '../../common/org-scoped.service';

// The icon libraries the dashboard's icon picker offers — kept as an allow-list (rather than
// letting a client request any of Iconify's 150+ collections) so results stay to the curated,
// production-quality sets actually asked for: Material Design, Phosphor, Tabler, Heroicons,
// brand logos (simple-icons, devicon), and an emoji set (twemoji).
export const ICONIFY_ALLOWED_PREFIXES = new Set(['mdi', 'ph', 'tabler', 'heroicons', 'simple-icons', 'devicon', 'twemoji']);

// Server-side defaults applied whenever a TEXT asset's style isn't specified — keeps the DB
// column meaning "explicitly chosen" vs. "use the default," while callers (dashboard, player)
// never have to special-case a null style themselves.
const DEFAULT_TEXT_STYLE = { textFontFamily: DEFAULT_FONT_ID, textColor: '#FFFFFF', textSize: 'MEDIUM' as TextSize };

// A few declared mimetypes can't be pinned to one exact magic-byte match: legacy OLE-based
// Office files (.doc/.ppt) all share the same outer "compound file" container signature
// (file-type reports both as application/x-cfb, since telling them apart requires parsing
// internal OLE streams), and OOXML files (.docx/.pptx) are technically zip archives, so a
// zip-signature match is accepted as a fallback alongside the specific OOXML mime file-type
// usually manages to detect. Anything not listed here must match its declared mimetype exactly.
const MAGIC_BYTE_COMPAT: Record<string, string[]> = {
  'audio/mp4': ['audio/mp4', 'video/mp4'],
  'audio/wav': ['audio/wav', 'audio/x-wav', 'audio/vnd.wave'],
  'application/msword': ['application/x-cfb'],
  'application/vnd.ms-powerpoint': ['application/x-cfb'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': [
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip',
  ],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/zip',
  ],
};

// Exported so the developer-facing library seed script (prisma/seed-library.ts) validates
// files against the exact same mimetype allowlist as the upload endpoint.
export const ALLOWED_MIME: Record<string, AssetType> = {
  'image/jpeg': 'IMAGE',
  'image/png': 'IMAGE',
  'image/gif': 'IMAGE',
  'image/webp': 'IMAGE',
  'video/mp4': 'VIDEO',
  'video/webm': 'VIDEO',
  'video/quicktime': 'VIDEO',
  'audio/mpeg': 'AUDIO',
  'audio/mp4': 'AUDIO',
  'audio/wav': 'AUDIO',
  'application/pdf': 'DOCUMENT',
  'application/vnd.ms-powerpoint': 'DOCUMENT',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'DOCUMENT',
  'application/msword': 'DOCUMENT',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCUMENT',
};

// Picks one Pexels video_files entry to actually download — prefers the smallest 'hd' variant
// (>=1280px wide) over 'sd' or the (often huge) original-quality file, to keep imports fast and
// storage bounded while still looking good on a signage display. Falls back to whatever's
// smallest by width if no 'hd' file is present.
function pickVideoFile(
  files: { link: string; quality: string | null; width: number | null; height: number | null }[],
): string | undefined {
  const byWidth = (a: typeof files[number], b: typeof files[number]) => (a.width ?? Infinity) - (b.width ?? Infinity);
  const hd = files.filter(f => f.quality === 'hd' && (f.width ?? 0) >= 1280).sort(byWidth);
  if (hd[0]) return hd[0].link;
  const sd = files.filter(f => f.quality === 'sd').sort(byWidth);
  if (sd[0]) return sd[0].link;
  return [...files].sort(byWidth)[0]?.link;
}

@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly orgScoped: OrgScopedService,
    private readonly config: ConfigService,
  ) {}

  async upload(
    orgId: string,
    file: Express.Multer.File,
    queueThumbnail: (assetId: string, key: string, type: AssetType, mimeType: string) => Promise<void>,
  ) {
    const assetType = ALLOWED_MIME[file.mimetype];
    if (!assetType) throw new BadRequestException(`Unsupported file type: ${file.mimetype}`);

    // `file.mimetype` is just the client-supplied Content-Type header — accepting it at face
    // value means a file uploaded with a spoofed header but arbitrary bytes inside gets stored
    // and served back with that same attacker-chosen type. Sniffing the actual content closes
    // that gap; a mismatch (including "no recognizable signature at all," which none of these
    // allowed types should ever produce for a genuine file) is rejected rather than silently
    // trusted.
    const { fileTypeFromBuffer } = await import('file-type');
    const detected = await fileTypeFromBuffer(file.buffer);
    const acceptableMimes = MAGIC_BYTE_COMPAT[file.mimetype] ?? [file.mimetype];
    if (!detected || !acceptableMimes.includes(detected.mime)) {
      throw new BadRequestException(
        `File content doesn't match its declared type (${file.mimetype})${detected ? ` — detected ${detected.mime}` : ''}.`,
      );
    }

    const ext = file.originalname.split('.').pop() ?? 'bin';
    const key = `${orgId}/assets/${crypto.randomUUID()}.${ext}`;

    await this.storage.upload(key, file.buffer, file.mimetype);

    const asset = await this.prisma.asset.create({
      data: {
        name: file.originalname,
        type: assetType,
        mimeType: file.mimetype,
        storageKey: key,
        sizeBytes: file.size,
        organizationId: orgId,
        status: 'PROCESSING',
      },
    });

    await queueThumbnail(asset.id, key, assetType, file.mimetype);

    return this.toDto(asset, null);
  }

  /**
   * Converts an already-uploaded VIDEO asset into a brand-new, separate AUDIO asset — the
   * source video is left untouched. `targetKey` is allocated up front (before the worker has
   * produced anything) so the new Asset row can be created immediately with status PROCESSING,
   * the same "create now, worker fills in the rest" pattern upload() uses.
   */
  async extractAudioFromVideo(
    orgId: string,
    sourceId: string,
    enqueueExtractAudio: (assetId: string, sourceKey: string, targetKey: string, deleteSourceKey?: string) => Promise<void>,
  ) {
    const source = await this.orgScoped.assertOwns(
      () => this.prisma.asset.findFirst({ where: { id: sourceId, organizationId: orgId } }),
      'Asset not found',
    );
    if (source.type !== 'VIDEO') throw new BadRequestException('Only video assets can be converted to audio');
    if (source.status !== 'READY') throw new BadRequestException('The video must finish processing first');
    if (!source.hasAudioTrack) throw new BadRequestException('This video has no audio track to extract');

    const targetKey = `${orgId}/assets/${crypto.randomUUID()}.m4a`;
    const asset = await this.prisma.asset.create({
      data: {
        name: `${source.name} (Audio)`,
        type: 'AUDIO',
        mimeType: 'audio/mp4',
        storageKey: targetKey,
        sizeBytes: 0,
        organizationId: orgId,
        status: 'PROCESSING',
      },
    });

    await enqueueExtractAudio(asset.id, source.storageKey, targetKey);
    return this.toDto(asset, null);
  }

  /**
   * Uploads a video file purely as a means to get its audio track — the video itself is never
   * kept as an asset. The raw upload lands at a throwaway tmp/ key that the worker deletes once
   * extraction finishes (success or failure), so it never lingers as an orphaned object with no
   * Asset row pointing at it.
   */
  async uploadAudioFromVideo(
    orgId: string,
    file: Express.Multer.File,
    enqueueExtractAudio: (assetId: string, sourceKey: string, targetKey: string, deleteSourceKey?: string) => Promise<void>,
  ) {
    if (ALLOWED_MIME[file.mimetype] !== 'VIDEO') {
      throw new BadRequestException(`Expected a video file to extract audio from, got: ${file.mimetype}`);
    }

    const ext = file.originalname.split('.').pop() ?? 'bin';
    const tempKey = `${orgId}/assets/tmp/${crypto.randomUUID()}.${ext}`;
    await this.storage.upload(tempKey, file.buffer, file.mimetype);

    const targetKey = `${orgId}/assets/${crypto.randomUUID()}.m4a`;
    const name = file.originalname.replace(/\.[^.]+$/, '');
    const asset = await this.prisma.asset.create({
      data: {
        name: `${name} (Audio)`,
        type: 'AUDIO',
        mimeType: 'audio/mp4',
        storageKey: targetKey,
        sizeBytes: 0,
        organizationId: orgId,
        status: 'PROCESSING',
      },
    });

    await enqueueExtractAudio(asset.id, tempKey, targetKey, tempKey);
    return this.toDto(asset, null);
  }

  /** Re-queues thumbnail/transcode generation for an asset stuck in ERROR (e.g. a transient worker failure) — same queue path as upload(), just re-armed on the existing storageKey. */
  async reprocess(
    orgId: string,
    id: string,
    queueThumbnail: (assetId: string, key: string, type: AssetType, mimeType: string) => Promise<void>,
  ) {
    const asset = await this.orgScoped.assertOwns(
      () => this.prisma.asset.findFirst({ where: { id, organizationId: orgId } }),
      'Asset not found',
    );
    if (asset.status !== 'ERROR') throw new BadRequestException('Only a failed asset can be reprocessed');
    if (asset.type !== 'IMAGE' && asset.type !== 'VIDEO' && asset.type !== 'DOCUMENT') {
      throw new BadRequestException('This asset type has nothing to reprocess');
    }

    const updated = await this.prisma.asset.update({ where: { id }, data: { status: 'PROCESSING' } });
    await queueThumbnail(asset.id, asset.storageKey, asset.type, asset.mimeType);
    return this.toDto(updated, null);
  }

  async createText(
    orgId: string,
    name: string,
    content: string,
    style: {
      textFontFamily?: string; textColor?: string; textSize?: TextSize; textBackgroundColor?: string;
      textTickerEnabled?: boolean; textTickerDirection?: TickerDirection; textTickerSpeed?: number; textTickerCrossOffset?: number;
    } = {},
  ) {
    // No object ever gets uploaded for a TEXT asset — the content lives in `textContent` —
    // so storageKey is just a unique placeholder, never a real S3 key. remove() below skips
    // the storage.delete() call for this type so that placeholder is never dereferenced either.
    const asset = await this.prisma.asset.create({
      data: {
        name,
        type: 'TEXT',
        mimeType: 'text/plain',
        storageKey: `${orgId}/text/${crypto.randomUUID()}`,
        sizeBytes: Buffer.byteLength(content, 'utf8'),
        textContent: content,
        textFontFamily: style.textFontFamily ?? DEFAULT_TEXT_STYLE.textFontFamily,
        textColor: style.textColor ?? DEFAULT_TEXT_STYLE.textColor,
        textSize: style.textSize ?? DEFAULT_TEXT_STYLE.textSize,
        // Unlike font/color/size, no default here — null means transparent, i.e. the player's
        // own black background shows through, which is the historical (pre-this-field) look.
        textBackgroundColor: style.textBackgroundColor ?? null,
        textTickerEnabled: style.textTickerEnabled ?? false,
        textTickerDirection: style.textTickerDirection ?? 'RIGHT_TO_LEFT',
        textTickerSpeed: style.textTickerSpeed ?? null,
        textTickerCrossOffset: style.textTickerCrossOffset ?? null,
        organizationId: orgId,
        status: 'READY',
      },
    });
    return this.toDto(asset, null);
  }

  async updateText(
    orgId: string,
    id: string,
    dto: {
      name?: string; content?: string; textFontFamily?: string; textColor?: string; textSize?: TextSize; textBackgroundColor?: string;
      textTickerEnabled?: boolean; textTickerDirection?: TickerDirection; textTickerSpeed?: number; textTickerCrossOffset?: number;
    },
  ) {
    const asset = await this.orgScoped.assertOwns(
      () => this.prisma.asset.findFirst({ where: { id, organizationId: orgId } }),
      'Asset not found',
    );
    if (asset.type !== 'TEXT') throw new BadRequestException('Only text assets can be edited this way');

    const updated = await this.prisma.asset.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.content !== undefined ? { textContent: dto.content, sizeBytes: Buffer.byteLength(dto.content, 'utf8') } : {}),
        ...(dto.textFontFamily !== undefined ? { textFontFamily: dto.textFontFamily } : {}),
        ...(dto.textColor !== undefined ? { textColor: dto.textColor } : {}),
        ...(dto.textSize !== undefined ? { textSize: dto.textSize } : {}),
        ...(dto.textBackgroundColor !== undefined ? { textBackgroundColor: dto.textBackgroundColor } : {}),
        ...(dto.textTickerEnabled !== undefined ? { textTickerEnabled: dto.textTickerEnabled } : {}),
        ...(dto.textTickerDirection !== undefined ? { textTickerDirection: dto.textTickerDirection } : {}),
        ...(dto.textTickerSpeed !== undefined ? { textTickerSpeed: dto.textTickerSpeed } : {}),
        ...(dto.textTickerCrossOffset !== undefined ? { textTickerCrossOffset: dto.textTickerCrossOffset } : {}),
      },
    });
    return this.toDto(updated, null);
  }

  async createApp(
    orgId: string,
    resolved: { providerId: string; sourceUrl: string; title: string; thumbnailUrl: string | null; embedUrl: string; width: number | null; height: number | null },
    name?: string,
  ) {
    // Same "nothing ever uploaded" pattern as createText — the embed is described entirely by
    // appConfig, so storageKey is just a unique placeholder. remove() below skips storage.delete()
    // for this type too.
    let finalName = resolved.title;
    const trimmedName = name?.trim();
    if (trimmedName) finalName = trimmedName;
    const asset = await this.prisma.asset.create({
      data: {
        name: finalName,
        type: 'APP',
        mimeType: 'text/html',
        storageKey: `${orgId}/app/${crypto.randomUUID()}`,
        sizeBytes: 0,
        appProviderId: resolved.providerId,
        sourceUrl: resolved.sourceUrl,
        appConfig: {
          kind: 'video',
          title: resolved.title,
          thumbnailUrl: resolved.thumbnailUrl,
          embedUrl: resolved.embedUrl,
          width: resolved.width,
          height: resolved.height,
        },
        organizationId: orgId,
        status: 'READY',
      },
    });
    return this.toDto(asset, ...this.appUrls(asset));
  }

  /** A curated, ordered list of videos from one provider — created from the Apps tab's "Create
   * Playlist" flow. Stored as a single APP asset (appConfig.kind: 'playlist') rather than a
   * separate table: see appsroadmap.md's Phase 6 design note for why. */
  async createAppPlaylist(
    orgId: string,
    providerId: string,
    name: string,
    items: { sourceUrl: string; title: string; thumbnailUrl: string | null; embedUrl: string }[],
    playbackOrder: 'SEQUENTIAL' | 'SHUFFLE',
  ) {
    const asset = await this.prisma.asset.create({
      data: {
        name,
        type: 'APP',
        mimeType: 'text/html',
        storageKey: `${orgId}/app/${crypto.randomUUID()}`,
        sizeBytes: 0,
        appProviderId: providerId,
        // No single sourceUrl for a playlist of many — appConfig.items carries each one instead.
        sourceUrl: null,
        appConfig: {
          kind: 'playlist',
          playbackOrder,
          items: items.map(i => ({ sourceUrl: i.sourceUrl, title: i.title, thumbnailUrl: i.thumbnailUrl, embedUrl: i.embedUrl })),
        },
        organizationId: orgId,
        status: 'READY',
      },
    });
    return this.toDto(asset, ...this.appUrls(asset));
  }

  async list(orgId: string) {
    const assets = await this.prisma.asset.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { playlistItems: true, screens: true, zones: true } } },
    });
    return assets.map(a => {
      const usageCount = a._count.playlistItems + a._count.screens + a._count.zones;
      // TEXT/APP assets have no real object behind storageKey (see createText/createApp) — a
      // "url" built from it would 404, so each derives its own url/thumbnail instead.
      if (a.type === 'TEXT') return this.toDto(a, null, undefined, undefined, usageCount);
      if (a.type === 'APP') return this.toDto(a, ...this.appUrls(a), usageCount);
      const url = this.storage.publicUrl(a.storageKey);
      const downloadUrl = this.storage.publicUrl(a.storageKey, a.name);
      const thumbUrl = a.thumbnailKey ? this.storage.publicUrl(a.thumbnailKey) : null;
      return this.toDto(a, url, thumbUrl, downloadUrl, usageCount);
    });
  }

  private appUrls(asset: { appConfig: unknown }): [string | null, string | null, null] {
    const cfg = asset.appConfig as
      | { kind?: string; embedUrl?: string; thumbnailUrl?: string | null; items?: { thumbnailUrl?: string | null }[] }
      | null;
    if (cfg?.kind === 'playlist') return [null, cfg.items?.[0]?.thumbnailUrl ?? null, null];
    return [cfg?.embedUrl ?? null, cfg?.thumbnailUrl ?? null, null];
  }

  /** Stamps lastUsedAt = now — called when an asset is picked in an editor's "existing asset" picker (Layouts/Themes Add Item), driving that picker's "recently used" sort. */
  async touch(orgId: string, id: string) {
    await this.orgScoped.assertOwns(
      () => this.prisma.asset.findFirst({ where: { id, organizationId: orgId } }),
      'Asset not found',
    );
    await this.prisma.asset.update({ where: { id }, data: { lastUsedAt: new Date() } });
  }

  /** Stock assets (organizationId: null) uploaded by us via the seed-library script — every org can browse and copy them, none can edit or delete them. */
  async listLibrary(category?: AssetCategory, search?: string) {
    const assets = await this.prisma.asset.findMany({
      where: {
        organizationId: null,
        status: 'READY',
        ...(category && { category }),
        ...(search && {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { tags: { has: search.toLowerCase() } },
          ],
        }),
      },
      orderBy: { createdAt: 'desc' },
    });
    return assets.map((a: (typeof assets)[number]) => {
      const url = this.storage.publicUrl(a.storageKey);
      const thumbUrl = a.thumbnailKey ? this.storage.publicUrl(a.thumbnailKey) : null;
      return this.toDto(a, url, thumbUrl, null);
    });
  }

  /** Copies a library asset into the org's own asset collection — same storageKey (no re-upload), new row so rename/delete/playlist references work exactly like any other org asset. */
  async copyFromLibrary(orgId: string, id: string) {
    const source = await this.orgScoped.assertOwns(
      () => this.prisma.asset.findFirst({ where: { id, organizationId: null }, include: { binaries: true } }),
      'Library asset not found',
    );

    const copy = await this.prisma.asset.create({
      data: {
        name: source.name,
        type: source.type,
        mimeType: source.mimeType,
        storageKey: source.storageKey,
        thumbnailKey: source.thumbnailKey,
        sizeBytes: source.sizeBytes,
        durationSecs: source.durationSecs,
        width: source.width,
        height: source.height,
        pageCount: source.pageCount,
        category: source.category,
        tags: source.tags,
        status: 'READY',
        organizationId: orgId,
        binaries: {
          create: source.binaries.map(binary => ({
            kind: binary.kind,
            ordinal: binary.ordinal,
            storageKey: binary.storageKey,
            mimeType: binary.mimeType,
            sizeBytes: binary.sizeBytes,
            sha256: binary.sha256,
          })),
        },
      },
    });

    const url = this.storage.publicUrl(copy.storageKey);
    const downloadUrl = this.storage.publicUrl(copy.storageKey, copy.name);
    const thumbUrl = copy.thumbnailKey ? this.storage.publicUrl(copy.thumbnailKey) : null;
    return this.toDto(copy, url, thumbUrl, downloadUrl);
  }

  /** Adds a new stock asset to the shared library (organizationId: null) — the in-app equivalent
   * of running seed-library.ts, reachable only by LIBRARY_MANAGER (see AssetsController). Same
   * mimetype/magic-byte validation as upload(); storage key uses the "system/" prefix
   * seed-library.ts already established rather than an org id, since there is none here. */
  async uploadToLibrary(
    file: Express.Multer.File,
    category: AssetCategory | undefined,
    tags: string[] | undefined,
    queueThumbnail: (assetId: string, key: string, type: AssetType, mimeType: string) => Promise<void>,
  ) {
    const assetType = ALLOWED_MIME[file.mimetype];
    if (!assetType) throw new BadRequestException(`Unsupported file type: ${file.mimetype}`);

    const { fileTypeFromBuffer } = await import('file-type');
    const detected = await fileTypeFromBuffer(file.buffer);
    const acceptableMimes = MAGIC_BYTE_COMPAT[file.mimetype] ?? [file.mimetype];
    if (!detected || !acceptableMimes.includes(detected.mime)) {
      throw new BadRequestException(
        `File content doesn't match its declared type (${file.mimetype})${detected ? ` — detected ${detected.mime}` : ''}.`,
      );
    }

    const ext = file.originalname.split('.').pop() ?? 'bin';
    const key = `system/assets/${crypto.randomUUID()}.${ext}`;
    await this.storage.upload(key, file.buffer, file.mimetype);

    const asset = await this.prisma.asset.create({
      data: {
        name: file.originalname,
        type: assetType,
        mimeType: file.mimetype,
        storageKey: key,
        sizeBytes: file.size,
        category: category ?? 'GENERIC',
        tags: tags ?? [],
        organizationId: null,
        status: 'PROCESSING',
      },
    });

    await queueThumbnail(asset.id, key, assetType, file.mimetype);
    return this.toDto(asset, null);
  }

  /** Renames / recategorizes / retags a library asset. There's no orgId to scope by — assertOwns
   * just confirms the row exists and is actually a library row (organizationId: null), not some
   * tenant's private asset. */
  async updateLibraryAsset(id: string, dto: { name?: string; category?: AssetCategory; tags?: string[] }) {
    await this.orgScoped.assertOwns(
      () => this.prisma.asset.findFirst({ where: { id, organizationId: null } }),
      'Library asset not found',
    );
    const updated = await this.prisma.asset.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.category !== undefined ? { category: dto.category } : {}),
        ...(dto.tags !== undefined ? { tags: dto.tags } : {}),
      },
    });
    const url = this.storage.publicUrl(updated.storageKey);
    const thumbUrl = updated.thumbnailKey ? this.storage.publicUrl(updated.thumbnailKey) : null;
    return this.toDto(updated, url, thumbUrl, null);
  }

  /** Removes a library listing. Tenant copies made via copyFromLibrary above own an independent
   * Asset row (their own id, same storageKey) — nothing ever references a library row's id
   * directly, so unlike remove() there's no playlist/screen/zone in-use check to run here. The
   * storage object itself is only deleted once no other row (a tenant's copy, or another library
   * row that happens to share the key) still points at it — same otherRefs gate remove() uses —
   * so retiring a library listing never breaks a tenant who already copied it. */
  async removeFromLibrary(id: string) {
    const asset = await this.orgScoped.assertOwns(
      () => this.prisma.asset.findFirst({ where: { id, organizationId: null } }),
      'Library asset not found',
    );
    const otherRefs = await this.prisma.asset.count({ where: { storageKey: asset.storageKey, id: { not: id } } });
    if (otherRefs === 0) {
      await this.storage.delete(asset.storageKey);
      if (asset.thumbnailKey) await this.storage.delete(asset.thumbnailKey);
    }
    await this.prisma.asset.delete({ where: { id } });
  }

  /** Whether PEXELS_API_KEY is set — drives the dashboard's "stock photos" tab between a live
   * search UI and a one-line setup hint, without the key itself ever reaching the client. */
  stockPhotosConfigured(): boolean {
    return !!this.config.get<string>('PEXELS_API_KEY');
  }

  /** Proxies Pexels search (or, with no query, its curated feed) server-side — the API key
   * never goes to the browser, unlike the reference implementation this was ported from, which
   * called Pexels directly from client code with the key baked into the bundle. */
  async searchStockPhotos(query: string | undefined, page: number) {
    const apiKey = this.config.get<string>('PEXELS_API_KEY');
    if (!apiKey) return [];

    const endpoint = query?.trim()
      ? `https://api.pexels.com/v1/search?query=${encodeURIComponent(query.trim())}&per_page=24&page=${page}`
      : `https://api.pexels.com/v1/curated?per_page=24&page=${page}`;

    const res = await fetch(endpoint, { headers: { Authorization: apiKey } });
    if (!res.ok) throw new BadRequestException('Stock photo search is temporarily unavailable');
    const data = (await res.json()) as {
      photos: {
        id: number; width: number; height: number; alt: string | null;
        photographer: string; photographer_url: string;
        src: { medium: string; large2x: string; large: string };
      }[];
    };

    return data.photos.map(p => ({
      id: p.id,
      thumbnailUrl: p.src.medium,
      previewUrl: p.src.large2x ?? p.src.large,
      width: p.width,
      height: p.height,
      photographer: p.photographer,
      photographerUrl: p.photographer_url,
      alt: p.alt,
    }));
  }

  /**
   * Imports one Pexels photo into the org's own assets. Re-looks up the photo by id server-side
   * (rather than trusting a client-supplied image URL) so the only host this ever fetches image
   * bytes from is api.pexels.com/images.pexels.com — never an arbitrary caller-chosen URL.
   */
  async importStockPhoto(
    orgId: string,
    photoId: number,
    queueThumbnail: (assetId: string, key: string, type: AssetType, mimeType: string) => Promise<void>,
  ) {
    const apiKey = this.config.get<string>('PEXELS_API_KEY');
    if (!apiKey) throw new BadRequestException('Stock photos are not configured on this server');

    const photoRes = await fetch(`https://api.pexels.com/v1/photos/${photoId}`, { headers: { Authorization: apiKey } });
    if (!photoRes.ok) throw new BadRequestException("Couldn't find that stock photo");
    const photo = (await photoRes.json()) as {
      alt: string | null; photographer: string;
      src: { original: string; large2x: string; large: string };
    };

    const imageRes = await fetch(photo.src.large2x ?? photo.src.large ?? photo.src.original);
    if (!imageRes.ok) throw new BadRequestException("Couldn't download that stock photo");
    const contentLength = Number(imageRes.headers.get('content-length') ?? 0);
    if (contentLength > 20 * 1024 * 1024) throw new BadRequestException('That stock photo is too large to import');
    const buffer = Buffer.from(await imageRes.arrayBuffer());

    // Same magic-byte sniff as a direct upload — trust nothing about what a third party claims
    // a file is, only what it actually contains.
    const { fileTypeFromBuffer } = await import('file-type');
    const detected = await fileTypeFromBuffer(buffer);
    const assetType = detected ? ALLOWED_MIME[detected.mime] : undefined;
    if (!detected || assetType !== 'IMAGE') {
      throw new BadRequestException("That stock photo doesn't look like a valid image");
    }

    const key = `${orgId}/assets/${crypto.randomUUID()}.${detected.ext}`;
    await this.storage.upload(key, buffer, detected.mime);

    let name = `Stock photo by ${photo.photographer}`;
    const trimmedAlt = photo.alt?.trim();
    if (trimmedAlt) name = trimmedAlt;
    const asset = await this.prisma.asset.create({
      data: {
        name,
        type: 'IMAGE',
        mimeType: detected.mime,
        storageKey: key,
        sizeBytes: buffer.length,
        category: 'STOCK_PHOTO',
        tags: ['pexels'],
        organizationId: orgId,
        status: 'PROCESSING',
      },
    });

    await queueThumbnail(asset.id, key, 'IMAGE', detected.mime);
    return this.toDto(asset, null);
  }

  /** Proxies Pexels' video search server-side — same PEXELS_API_KEY as stock photos, same
   * "key never reaches the browser" reasoning as searchStockPhotos above. */
  async searchStockVideos(query: string | undefined, page: number) {
    const apiKey = this.config.get<string>('PEXELS_API_KEY');
    if (!apiKey) return [];

    const endpoint = query?.trim()
      ? `https://api.pexels.com/videos/search?query=${encodeURIComponent(query.trim())}&per_page=24&page=${page}`
      : `https://api.pexels.com/videos/popular?per_page=24&page=${page}`;

    const res = await fetch(endpoint, { headers: { Authorization: apiKey } });
    if (!res.ok) throw new BadRequestException('Stock video search is temporarily unavailable');
    const data = (await res.json()) as {
      videos: {
        id: number; width: number; height: number; duration: number;
        image: string;
        user: { name: string; url: string };
        video_files: { link: string; quality: string | null; width: number | null; height: number | null }[];
      }[];
    };

    return data.videos.map(v => ({
      id: v.id,
      thumbnailUrl: v.image,
      previewUrl: pickVideoFile(v.video_files),
      width: v.width,
      height: v.height,
      duration: v.duration,
      photographer: v.user.name,
      photographerUrl: v.user.url,
    }));
  }

  /**
   * Imports one Pexels video into the org's own assets — mirrors importStockPhoto above,
   * including re-looking up the video by id server-side rather than trusting a client-supplied
   * URL, and capping the download size (larger than the photo cap: video files run bigger).
   */
  async importStockVideo(
    orgId: string,
    videoId: number,
    queueThumbnail: (assetId: string, key: string, type: AssetType, mimeType: string) => Promise<void>,
  ) {
    const apiKey = this.config.get<string>('PEXELS_API_KEY');
    if (!apiKey) throw new BadRequestException('Stock videos are not configured on this server');

    const videoRes = await fetch(`https://api.pexels.com/videos/videos/${videoId}`, { headers: { Authorization: apiKey } });
    if (!videoRes.ok) throw new BadRequestException("Couldn't find that stock video");
    const video = (await videoRes.json()) as {
      user: { name: string };
      video_files: { link: string; quality: string | null; width: number | null; height: number | null }[];
    };

    const fileUrl = pickVideoFile(video.video_files);
    if (!fileUrl) throw new BadRequestException("That stock video doesn't have a downloadable file");

    const fileRes = await fetch(fileUrl);
    if (!fileRes.ok) throw new BadRequestException("Couldn't download that stock video");
    const contentLength = Number(fileRes.headers.get('content-length') ?? 0);
    if (contentLength > 150 * 1024 * 1024) throw new BadRequestException('That stock video is too large to import');
    const buffer = Buffer.from(await fileRes.arrayBuffer());

    const { fileTypeFromBuffer } = await import('file-type');
    const detected = await fileTypeFromBuffer(buffer);
    const assetType = detected ? ALLOWED_MIME[detected.mime] : undefined;
    if (!detected || assetType !== 'VIDEO') {
      throw new BadRequestException("That stock video doesn't look like a valid video");
    }

    const key = `${orgId}/assets/${crypto.randomUUID()}.${detected.ext}`;
    await this.storage.upload(key, buffer, detected.mime);

    const asset = await this.prisma.asset.create({
      data: {
        name: `Stock video by ${video.user.name}`,
        type: 'VIDEO',
        mimeType: detected.mime,
        storageKey: key,
        sizeBytes: buffer.length,
        category: 'VIDEO_LOOP',
        tags: ['pexels'],
        organizationId: orgId,
        status: 'PROCESSING',
      },
    });

    await queueThumbnail(asset.id, key, 'VIDEO', detected.mime);
    return this.toDto(asset, null);
  }

  /**
   * Searches Iconify's free public API (no key required — it's a keyless, rate-limited CDN) for
   * icons across a curated set of libraries, so "search icons" doesn't surface Iconify's entire
   * 200k+-icon catalog across hundreds of obscure collections. Only icon ids come back here (the
   * dashboard renders search-result thumbnails directly from Iconify's CDN as plain <img>s,
   * which is safe — a browser never executes script from an <img src> even if the response were
   * SVG with embedded script); the actual SVG markup is only fetched, sanitized, and stored once
   * the user picks one, via fetchIconSvg below.
   */
  async searchIcons(query: string, prefixes: string[]) {
    const allowed = prefixes.filter(p => ICONIFY_ALLOWED_PREFIXES.has(p));
    if (!query.trim() || allowed.length === 0) return [];

    const res = await fetch(
      `https://api.iconify.design/search?query=${encodeURIComponent(query.trim())}&prefixes=${allowed.join(',')}&limit=64`,
    );
    if (!res.ok) throw new BadRequestException('Icon search is temporarily unavailable');
    const data = (await res.json()) as { icons: string[] };
    return data.icons;
  }

  /**
   * Fetches one icon's SVG from Iconify server-side and sanitizes it before it's ever stored on
   * a theme element or rendered (via dangerouslySetInnerHTML) in the dashboard/player — Iconify's
   * catalog is curated and generally trustworthy, but this endpoint accepts a client-supplied
   * icon id, so the response is treated as untrusted input regardless of the source. Storing the
   * sanitized markup directly on the element (rather than as an Asset row) means kiosk playback
   * never depends on Iconify's availability again after the icon is picked.
   */
  async fetchIconSvg(iconId: string): Promise<string> {
    const match = /^([a-z0-9-]+):([a-z0-9-]+)$/.exec(iconId);
    if (!match || !ICONIFY_ALLOWED_PREFIXES.has(match[1]!)) {
      throw new BadRequestException('Unknown icon');
    }
    const [, prefix, name] = match;

    const res = await fetch(`https://api.iconify.design/${prefix}/${name}.svg`);
    if (!res.ok) throw new BadRequestException("Couldn't find that icon");
    const raw = await res.text();
    if (!raw.trimStart().startsWith('<svg')) throw new BadRequestException("That doesn't look like an icon");

    const sanitized = DOMPurify.sanitize(raw, { USE_PROFILES: { svg: true, svgFilters: true } });
    if (!sanitized) throw new BadRequestException("That icon couldn't be imported");

    // Iconify's raw SVGs are sized in `em` units (e.g. width="1em" height="1em"), meant for
    // inline text use — replaced with 100%/100% so the icon fills whatever box the theme element
    // gives it (same box model as every other element kind) instead of rendering at ~1 line-height.
    return sanitized.replace(/^<svg([^>]*)>/, (_full, attrs: string) => {
      const stripped = attrs.replace(/\s(width|height)="[^"]*"/gi, '');
      return `<svg${stripped} width="100%" height="100%">`;
    });
  }

  async findOne(orgId: string, id: string) {
    const asset = await this.orgScoped.assertOwns(
      () => this.prisma.asset.findFirst({ where: { id, organizationId: orgId } }),
      'Asset not found',
    );
    if (asset.type === 'TEXT') return this.toDto(asset, null);
    if (asset.type === 'APP') return this.toDto(asset, ...this.appUrls(asset));

    const url = this.storage.publicUrl(asset.storageKey);
    const downloadUrl = this.storage.publicUrl(asset.storageKey, asset.name);
    const thumbUrl = asset.thumbnailKey ? this.storage.publicUrl(asset.thumbnailKey) : null;
    return this.toDto(asset, url, thumbUrl, downloadUrl);
  }

  async rename(orgId: string, id: string, name: string) {
    await this.orgScoped.assertOwns(
      () => this.prisma.asset.findFirst({ where: { id, organizationId: orgId } }),
      'Asset not found',
    );
    return this.toDto(await this.prisma.asset.update({ where: { id }, data: { name } }), null);
  }

  async setAudioEnabled(orgId: string, id: string, audioEnabled: boolean) {
    const asset = await this.orgScoped.assertOwns(
      () => this.prisma.asset.findFirst({ where: { id, organizationId: orgId } }),
      'Asset not found',
    );
    if (asset.type !== 'VIDEO' || !asset.hasAudioTrack) {
      throw new BadRequestException('Only videos with a detected audio track have an audio choice');
    }
    return this.toDto(await this.prisma.asset.update({ where: { id }, data: { audioEnabled } }), null);
  }

  async remove(orgId: string, id: string) {
    const asset = await this.orgScoped.assertOwns(
      () => this.prisma.asset.findFirst({ where: { id, organizationId: orgId } }),
      'Asset not found',
    );

    // Check for playlist/screen/zone references *before* touching storage — Asset -> PlaylistItem
    // has no onDelete: Cascade (Screen.assetId/Zone.assetId are ON DELETE SET NULL, so those
    // wouldn't fail the delete outright, but silently orphaning a screen/zone that's actively
    // streaming this asset is exactly the footgun this check exists to prevent). Previously the
    // playlist check ran last, after the storage files were already deleted: the delete would
    // fail here, but the actual file was already gone, leaving a DB row with dead storageKey/
    // thumbnailKey references (a broken preview that a real refresh wouldn't fix, since the row
    // was never actually removed).
    // Count distinct playlists, not raw item rows — the same asset can appear more than once
    // within a single playlist, which would otherwise inflate this above the actual number of
    // playlists the "Remove it from those playlists" message below is telling the user to check.
    const [usedInPlaylists, screenCount, zoneCount] = await Promise.all([
      this.prisma.playlistItem.findMany({
        where: { assetId: id },
        select: { playlistId: true },
        distinct: ['playlistId'],
      }),
      this.prisma.screen.count({ where: { assetId: id } }),
      this.prisma.zone.count({ where: { assetId: id } }),
    ]);
    const usageCount = usedInPlaylists.length + screenCount + zoneCount;
    if (usageCount > 0) {
      throw new BadRequestException(
        `This asset is in use (${usageCount} reference${usageCount === 1 ? '' : 's'} across playlists, screens, or layout zones). Remove those references before deleting.`,
      );
    }

    // TEXT/APP assets never had anything uploaded (see createText/createApp) — deleting their
    // placeholder storageKey would just be a wasted round-trip to the storage backend. Assets
    // copied from the library (see copyFromLibrary) share their storageKey/thumbnailKey with the
    // library original and every other org's copy — only delete the actual object once nothing
    // else still points at it, or every other copy silently loses its file underneath it.
    const otherRefs = await this.prisma.asset.count({ where: { storageKey: asset.storageKey, id: { not: id } } });
    if (asset.type !== 'TEXT' && asset.type !== 'APP' && otherRefs === 0) {
      await this.storage.delete(asset.storageKey);
      if (asset.thumbnailKey) await this.storage.delete(asset.thumbnailKey);
    }
    await this.prisma.asset.delete({ where: { id } });
  }

  private toDto(
    asset: { id: string; name: string; type: AssetType; mimeType: string; storageKey: string; thumbnailKey: string | null; sizeBytes: bigint; durationSecs: number | null; width: number | null; height: number | null; pageCount: number | null; textContent: string | null; textFontFamily: string | null; textColor: string | null; textSize: TextSize | null; textBackgroundColor: string | null; textTickerEnabled: boolean; textTickerDirection: TickerDirection; textTickerSpeed: number | null; textTickerCrossOffset: number | null; hasAudioTrack: boolean; audioEnabled: boolean; appProviderId: string | null; sourceUrl: string | null; appConfig: unknown; status: string; category: AssetCategory; tags: string[]; organizationId: string | null; createdAt: Date; lastUsedAt?: Date | null },
    url: string | null,
    thumbUrl?: string | null,
    downloadUrl?: string | null,
    usageCount?: number,
  ) {
    return {
      id: asset.id,
      name: asset.name,
      type: asset.type,
      mimeType: asset.mimeType,
      sizeBytes: Number(asset.sizeBytes),
      durationSecs: asset.durationSecs,
      width: asset.width,
      height: asset.height,
      pageCount: asset.pageCount,
      textContent: asset.textContent,
      textFontFamily: asset.textFontFamily,
      textColor: asset.textColor,
      textSize: asset.textSize,
      textBackgroundColor: asset.textBackgroundColor,
      textTickerEnabled: asset.textTickerEnabled,
      textTickerDirection: asset.textTickerDirection,
      textTickerSpeed: asset.textTickerSpeed,
      textTickerCrossOffset: asset.textTickerCrossOffset,
      hasAudioTrack: asset.hasAudioTrack,
      audioEnabled: asset.audioEnabled,
      appProviderId: asset.appProviderId,
      sourceUrl: asset.sourceUrl,
      appConfig: asset.appConfig,
      status: asset.status,
      category: asset.category,
      tags: asset.tags,
      url,
      thumbnailUrl: thumbUrl ?? null,
      downloadUrl: downloadUrl ?? null,
      organizationId: asset.organizationId,
      createdAt: asset.createdAt.toISOString(),
      lastUsedAt: asset.lastUsedAt ? asset.lastUsedAt.toISOString() : null,
      usageCount,
      inUse: usageCount !== undefined ? usageCount > 0 : undefined,
    };
  }
}
