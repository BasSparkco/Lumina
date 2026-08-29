import type { PlayerAssetManifestItem, PlayerManifestPriority } from '@lumina/types';
import type { MediaAssetDescriptor, MediaStorage, StoredMediaPartial } from '../media-storage/types';
import { Semaphore } from './semaphore.js';
import type {
  AssetSyncResult,
  DownloadPool,
  DownloadProgress,
  MediaDownloadManager,
  MediaDownloadManagerOptions,
  SyncResult,
} from './types';

const DEFAULT_RETRY_DELAYS = [0, 2_000, 5_000, 15_000, 30_000] as const;
const PRIORITY_RANK: Record<PlayerManifestPriority, number> = {
  current: 0,
  next: 1,
  scheduled: 2,
  fallback: 3,
};

interface ResolvedOptions {
  largeFileThresholdBytes: number;
  startupJitterMaxMs: number;
  retryDelaysMs: readonly number[];
  backgroundRetryDelayMs: number;
  connectionTimeoutMs: number;
  noProgressTimeoutMs: number;
  baseAttemptTimeoutMs: number;
  minimumThroughputBytesPerSecond: number;
  maxAttemptTimeoutMs: number;
  fetch: typeof fetch;
  random: () => number;
  now: () => number;
}

interface InFlightTask {
  asset: MediaAssetDescriptor;
  controller: AbortController;
  promise: Promise<AssetSyncResult>;
}

class NonRetryableDownloadError extends Error {}
class RestartDownloadError extends Error {}

function identityKey(namespace: string, asset: PlayerAssetManifestItem): string {
  return `${namespace}/${asset.assetId}/${asset.binaryId}/${asset.binaryVersion}`;
}

function descriptor(namespace: string, asset: PlayerAssetManifestItem): MediaAssetDescriptor {
  return { ...asset, namespace };
}

function partialDescriptor(partial: StoredMediaPartial): MediaAssetDescriptor {
  return {
    namespace: partial.namespace,
    assetId: partial.assetId,
    binaryId: partial.binaryId,
    binaryVersion: partial.binaryVersion,
    sha256: partial.sha256,
    mimeType: partial.mimeType,
    fileSize: partial.expectedBytes,
    type: 'other',
    priority: 'fallback',
    remoteUrl: '',
    networkRequired: false,
  };
}

function abortError(message: string): DOMException {
  return new DOMException(message, 'AbortError');
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : abortError('Operation aborted');
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return signal.aborted ? Promise.reject(abortReason(signal)) : Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function responseValidator(response: Response): string | null {
  const etag = response.headers.get('etag');
  if (etag) return `etag:${etag}`;
  const lastModified = response.headers.get('last-modified');
  return lastModified ? `last-modified:${lastModified}` : null;
}

function parseContentRange(value: string | null): { start: number; end: number; total: number } | null {
  if (!value) return null;
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/i.exec(value.trim());
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  if (![start, end, total].every(Number.isSafeInteger) || start < 0 || end < start || total <= end) return null;
  return { start, end, total };
}

function syncUrl(remoteUrl: string, binaryVersion: string): string {
  const url = new URL(remoteUrl, window.location.href);
  // Phase 0's Service Worker owns renderer requests for .mp4/.webm. The explicit marker keeps a
  // download-manager fetch from being copied into temporary Cache Storage before it reaches OPFS.
  url.searchParams.set('__lumina_media_sync', '1');
  url.searchParams.set('v', binaryVersion);
  return url.href;
}

export function sortManifestForDownload(
  assets: readonly PlayerAssetManifestItem[],
): PlayerAssetManifestItem[] {
  return assets
    .map((asset, index) => ({ asset, index }))
    .sort((a, b) => PRIORITY_RANK[a.asset.priority] - PRIORITY_RANK[b.asset.priority] || a.index - b.index)
    .map(entry => entry.asset);
}

export class BrowserMediaDownloadManager implements MediaDownloadManager {
  private readonly largeSemaphore: Semaphore;
  private readonly lightweightSemaphore: Semaphore;
  private readonly options: ResolvedOptions;
  private readonly inFlight = new Map<string, InFlightTask>();
  private readonly backgroundTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly progress = new Map<string, DownloadProgress>();
  private readonly lastProgressNotification = new Map<string, number>();
  private readonly listeners = new Set<() => void>();
  private desiredKeys = new Set<string>();
  private manifestGeneration = 0;
  private manifestSignature = '';
  private startupReadyAt: number | null = null;
  private disposed = false;

  constructor(private readonly storage: MediaStorage, options: MediaDownloadManagerOptions = {}) {
    this.largeSemaphore = new Semaphore(options.largeConcurrency ?? 1);
    this.lightweightSemaphore = new Semaphore(options.lightweightConcurrency ?? 2);
    this.options = {
      largeFileThresholdBytes: options.largeFileThresholdBytes ?? 32 * 1024 * 1024,
      startupJitterMaxMs: options.startupJitterMaxMs ?? 5_000,
      retryDelaysMs: options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS,
      backgroundRetryDelayMs: options.backgroundRetryDelayMs ?? 5 * 60_000,
      connectionTimeoutMs: options.connectionTimeoutMs ?? 15_000,
      noProgressTimeoutMs: options.noProgressTimeoutMs ?? 30_000,
      baseAttemptTimeoutMs: options.baseAttemptTimeoutMs ?? 2 * 60_000,
      minimumThroughputBytesPerSecond: options.minimumThroughputBytesPerSecond ?? 64 * 1024,
      maxAttemptTimeoutMs: options.maxAttemptTimeoutMs ?? 4 * 60 * 60_000,
      fetch: options.fetch ?? fetch.bind(globalThis),
      random: options.random ?? Math.random,
      now: options.now ?? Date.now,
    };
    if (this.options.retryDelaysMs.length === 0) throw new Error('At least one download attempt is required');
    if (this.options.minimumThroughputBytesPerSecond <= 0) throw new Error('Minimum throughput must be positive');
  }

  async synchronize(manifest: readonly PlayerAssetManifestItem[]): Promise<SyncResult> {
    if (this.disposed) throw new Error('Media download manager has been disposed');
    const unique = new Map<string, PlayerAssetManifestItem>();
    for (const asset of manifest) unique.set(identityKey(this.storage.namespace, asset), asset);
    const sorted = sortManifestForDownload([...unique.values()]);
    const nextDesired = new Set(sorted.map(asset => identityKey(this.storage.namespace, asset)));
    const signature = sorted.map(asset => [
      identityKey(this.storage.namespace, asset), asset.priority, asset.remoteUrl, asset.fileSize,
    ].join(':')).join('|');
    if (signature !== this.manifestSignature) {
      this.manifestSignature = signature;
      this.manifestGeneration += 1;
    }
    const generation = this.manifestGeneration;
    this.desiredKeys = nextDesired;

    const cancelled = [...this.inFlight.entries()]
      .filter(([key]) => !nextDesired.has(key))
      .map(([, task]) => {
        task.controller.abort(abortError('Superseded by a newer media manifest'));
        return task.promise;
      });
    for (const [key, timer] of this.backgroundTimers) {
      if (!nextDesired.has(key)) {
        clearTimeout(timer);
        this.backgroundTimers.delete(key);
      }
    }
    await Promise.allSettled(cancelled);
    await this.discardSupersededPartials(nextDesired);

    const checks = await Promise.all(sorted.map(async asset => {
      const local = descriptor(this.storage.namespace, asset);
      this.setProgress(local, { status: 'CHECKING', receivedBytes: 0, attempt: 0, error: null });
      if (await this.storage.exists(local)) {
        this.setProgress(local, { status: 'AVAILABLE', receivedBytes: asset.fileSize, attempt: 0, error: null });
        return { asset: local, existing: 'AVAILABLE' as const };
      }
      const partial = await this.storage.getPartial(local);
      if (partial?.receivedBytes === asset.fileSize && partial.status === 'DOWNLOADED') {
        this.setProgress(local, { status: 'DOWNLOADED', receivedBytes: asset.fileSize, attempt: 0, error: null });
        return { asset: local, existing: 'DOWNLOADED' as const };
      }
      this.setProgress(local, {
        status: 'QUEUED', receivedBytes: partial?.receivedBytes ?? 0, attempt: 0, error: null,
      });
      return { asset: local, existing: null };
    }));

    const results = await Promise.all(checks.map(check => {
      const key = identityKey(this.storage.namespace, check.asset);
      if (generation !== this.manifestGeneration || !this.desiredKeys.has(key)) {
        this.setProgress(check.asset, { status: 'CANCELLED', error: 'Superseded by a newer media manifest' });
        return Promise.resolve(this.result(
          check.asset, 'CANCELLED', 0, 'Superseded by a newer media manifest',
        ));
      }
      if (check.existing) {
        return Promise.resolve<AssetSyncResult>({
          assetId: check.asset.assetId,
          binaryId: check.asset.binaryId,
          binaryVersion: check.asset.binaryVersion,
          status: check.existing,
          receivedBytes: check.asset.fileSize,
          error: null,
        });
      }
      return this.ensureDownload(check.asset);
    }));
    return this.summarize(results);
  }

  async cancel(assetId: string): Promise<void> {
    const tasks: Promise<AssetSyncResult>[] = [];
    for (const [key, task] of this.inFlight) {
      if (task.asset.assetId !== assetId) continue;
      this.desiredKeys.delete(key);
      task.controller.abort(abortError('Download cancelled'));
      tasks.push(task.promise);
    }
    for (const [key, timer] of this.backgroundTimers) {
      const state = this.progress.get(key);
      if (state?.assetId === assetId) {
        this.desiredKeys.delete(key);
        clearTimeout(timer);
        this.backgroundTimers.delete(key);
      }
    }
    for (const [key, state] of this.progress) {
      if (state.assetId === assetId) this.desiredKeys.delete(key);
    }
    await Promise.allSettled(tasks);
    const partials = await this.storage.listPartials();
    await Promise.all(partials.filter(partial => partial.assetId === assetId)
      .map(partial => this.storage.discardPartial(partialDescriptor(partial))));
  }

  getProgress(): DownloadProgress[] {
    return [...this.progress.values()].map(item => ({ ...item }));
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.disposed = true;
    for (const task of this.inFlight.values()) task.controller.abort(abortError('Download manager disposed'));
    for (const timer of this.backgroundTimers.values()) clearTimeout(timer);
    this.backgroundTimers.clear();
    this.listeners.clear();
    managerRegistry.delete(this.storage);
  }

  private ensureDownload(asset: MediaAssetDescriptor): Promise<AssetSyncResult> {
    const key = identityKey(this.storage.namespace, asset);
    const existing = this.inFlight.get(key);
    if (existing) {
      this.log('download-joined', asset, {});
      return existing.promise;
    }
    const controller = new AbortController();
    const promise = this.runDownload(asset, controller.signal)
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, { asset, controller, promise });
    return promise;
  }

  private async runDownload(asset: MediaAssetDescriptor, signal: AbortSignal): Promise<AssetSyncResult> {
    const key = identityKey(this.storage.namespace, asset);
    const semaphore = this.pool(asset) === 'large' ? this.largeSemaphore : this.lightweightSemaphore;
    let release: (() => void) | null = null;
    try {
      release = await semaphore.acquire(signal);
      this.startupReadyAt ??= this.options.now()
        + Math.floor(this.options.random() * this.options.startupJitterMaxMs);
      await delay(Math.max(0, this.startupReadyAt - this.options.now()), signal);

      let finalError: unknown;
      for (let index = 0; index < this.options.retryDelaysMs.length; index += 1) {
        const attempt = index + 1;
        const waitMs = this.options.retryDelaysMs[index] ?? 0;
        if (waitMs > 0) {
          this.setProgress(asset, {
            status: 'RETRY_WAIT', attempt, nextRetryAt: this.options.now() + waitMs,
            error: finalError instanceof Error ? finalError.message : String(finalError),
          });
          await delay(waitMs, signal);
        }
        try {
          const partial = await this.downloadAttempt(asset, attempt, signal);
          this.setProgress(asset, {
            status: 'DOWNLOADED', receivedBytes: partial.receivedBytes, attempt,
            nextRetryAt: null, error: null,
          });
          this.log('download-complete', asset, { attempt, bytes: partial.receivedBytes });
          return this.result(asset, 'DOWNLOADED', partial.receivedBytes, null);
        } catch (error) {
          if (signal.aborted) throw abortReason(signal);
          finalError = error;
          this.log('download-attempt-failed', asset, {
            attempt, error: error instanceof Error ? error.message : String(error),
          });
          if (error instanceof NonRetryableDownloadError) break;
          if (error instanceof RestartDownloadError) finalError = error;
        }
      }

      const partial = await this.storage.getPartial(asset);
      const message = finalError instanceof Error ? finalError.message : String(finalError);
      this.setProgress(asset, {
        status: 'FAILED', receivedBytes: partial?.receivedBytes ?? 0,
        attempt: this.options.retryDelaysMs.length, nextRetryAt: null, error: message,
      });
      this.scheduleBackgroundRetry(asset);
      return this.result(asset, 'FAILED', partial?.receivedBytes ?? 0, message);
    } catch (error) {
      const partial = await this.storage.getPartial(asset).catch(() => null);
      const message = error instanceof Error ? error.message : String(error);
      const status = signal.aborted ? 'CANCELLED' as const : 'FAILED' as const;
      this.setProgress(asset, {
        status, receivedBytes: partial?.receivedBytes ?? 0,
        nextRetryAt: null, error: message,
      });
      this.log(status === 'CANCELLED' ? 'download-cancelled' : 'download-failed', asset, { error: message });
      if (status === 'FAILED') this.scheduleBackgroundRetry(asset);
      return this.result(asset, status, partial?.receivedBytes ?? 0, message);
    } finally {
      release?.();
      if (!this.desiredKeys.has(key)) this.backgroundTimers.delete(key);
    }
  }

  private async downloadAttempt(
    asset: MediaAssetDescriptor,
    attempt: number,
    taskSignal: AbortSignal,
  ): Promise<StoredMediaPartial> {
    let partial = await this.storage.getPartial(asset);
    if (partial && partial.receivedBytes > 0 && partial.validator === null) {
      await this.storage.discardPartial(asset);
      partial = null;
    }
    let offset = partial?.receivedBytes ?? 0;
    if (offset === asset.fileSize && partial) return partial;

    const attemptController = new AbortController();
    const propagateAbort = () => attemptController.abort(taskSignal.reason);
    taskSignal.addEventListener('abort', propagateAbort, { once: true });
    const connectionTimer = setTimeout(() => {
      attemptController.abort(new DOMException('Media connection timeout', 'TimeoutError'));
    }, this.options.connectionTimeoutMs);
    const remaining = asset.fileSize - offset;
    const calculatedTimeout = Math.ceil(remaining / this.options.minimumThroughputBytesPerSecond * 1_000);
    const totalTimeoutMs = Math.min(
      this.options.maxAttemptTimeoutMs,
      Math.max(this.options.baseAttemptTimeoutMs, calculatedTimeout),
    );
    const totalTimer = setTimeout(() => {
      attemptController.abort(new DOMException('Media attempt timeout', 'TimeoutError'));
    }, totalTimeoutMs);
    let noProgressTimer: ReturnType<typeof setTimeout> | null = null;
    const resetNoProgress = () => {
      if (noProgressTimer) clearTimeout(noProgressTimer);
      noProgressTimer = setTimeout(() => {
        attemptController.abort(new DOMException('Media download made no progress', 'TimeoutError'));
      }, this.options.noProgressTimeoutMs);
    };

    try {
      const headers = new Headers();
      if (offset > 0) headers.set('Range', `bytes=${offset}-`);
      this.setProgress(asset, {
        status: 'DOWNLOADING', receivedBytes: offset, attempt, nextRetryAt: null, error: null,
      });
      this.log('download-start', asset, { attempt, offset });
      const response = await this.options.fetch(syncUrl(asset.remoteUrl, asset.binaryVersion), {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
        headers,
        signal: attemptController.signal,
      });
      clearTimeout(connectionTimer);

      if (!response.ok) {
        const message = `Media origin returned HTTP ${response.status}`;
        await response.body?.cancel();
        if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
          throw new NonRetryableDownloadError(message);
        }
        throw new Error(message);
      }

      const validator = responseValidator(response);
      if (offset > 0 && response.status === 200) {
        await this.storage.discardPartial(asset);
        partial = null;
        offset = 0;
      } else if (offset > 0) {
        const range = parseContentRange(response.headers.get('content-range'));
        if (response.status !== 206 || range?.start !== offset || range.total !== asset.fileSize) {
          await response.body?.cancel();
          await this.storage.discardPartial(asset);
          throw new RestartDownloadError('Origin rejected or changed the staged byte range');
        }
        if (partial?.validator !== validator) {
          await response.body?.cancel();
          await this.storage.discardPartial(asset);
          throw new RestartDownloadError('Origin validator changed during resumed download');
        }
      } else if (response.status !== 200) {
        await response.body?.cancel();
        throw new Error(`Expected full media response, received HTTP ${response.status}`);
      }

      const contentLength = Number(response.headers.get('content-length'));
      if (!Number.isSafeInteger(contentLength) || contentLength !== asset.fileSize - offset) {
        await response.body?.cancel();
        throw new Error(`Media Content-Length mismatch for ${asset.binaryId}`);
      }
      const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
      const expectedType = asset.mimeType.split(';', 1)[0]?.trim().toLowerCase();
      if (contentType && contentType !== 'application/octet-stream' && contentType !== expectedType) {
        await response.body?.cancel();
        throw new NonRetryableDownloadError(`Media Content-Type mismatch for ${asset.binaryId}`);
      }
      if (!response.body) throw new Error(`Media response has no body for ${asset.binaryId}`);

      resetNoProgress();
      const staged = await this.storage.writePartial(asset, response.body, {
        offset,
        validator,
        signal: attemptController.signal,
        onProgress: receivedBytes => {
          resetNoProgress();
          this.setProgress(asset, {
            status: 'DOWNLOADING', receivedBytes, attempt, nextRetryAt: null, error: null,
          }, false);
        },
      });
      if (staged.receivedBytes !== asset.fileSize) {
        throw new Error(`Media response ended at ${staged.receivedBytes} of ${asset.fileSize} bytes`);
      }
      return staged;
    } finally {
      clearTimeout(connectionTimer);
      clearTimeout(totalTimer);
      if (noProgressTimer) clearTimeout(noProgressTimer);
      taskSignal.removeEventListener('abort', propagateAbort);
    }
  }

  private pool(asset: PlayerAssetManifestItem): DownloadPool {
    return asset.type === 'video' || asset.fileSize >= this.options.largeFileThresholdBytes
      ? 'large'
      : 'lightweight';
  }

  private setProgress(
    asset: MediaAssetDescriptor,
    patch: Partial<DownloadProgress>,
    notify = true,
  ) {
    const key = identityKey(this.storage.namespace, asset);
    const existing = this.progress.get(key);
    const receivedBytes = patch.receivedBytes ?? existing?.receivedBytes ?? 0;
    const next: DownloadProgress = {
      key,
      assetId: asset.assetId,
      binaryId: asset.binaryId,
      binaryVersion: asset.binaryVersion,
      type: asset.type,
      priority: asset.priority,
      pool: this.pool(asset),
      status: patch.status ?? existing?.status ?? 'CHECKING',
      receivedBytes,
      totalBytes: asset.fileSize,
      percent: asset.fileSize > 0 ? Math.min(100, receivedBytes / asset.fileSize * 100) : 0,
      attempt: patch.attempt ?? existing?.attempt ?? 0,
      maxAttempts: this.options.retryDelaysMs.length,
      nextRetryAt: patch.nextRetryAt === undefined ? existing?.nextRetryAt ?? null : patch.nextRetryAt,
      error: patch.error === undefined ? existing?.error ?? null : patch.error,
      updatedAt: this.options.now(),
    };
    this.progress.set(key, next);
    const lastNotification = this.lastProgressNotification.get(key) ?? 0;
    if (notify || next.updatedAt - lastNotification >= 250) {
      this.lastProgressNotification.set(key, next.updatedAt);
      for (const listener of this.listeners) listener();
    }
  }

  private scheduleBackgroundRetry(asset: MediaAssetDescriptor) {
    const key = identityKey(this.storage.namespace, asset);
    if (!this.desiredKeys.has(key) || this.backgroundTimers.has(key) || this.disposed) return;
    const timer = setTimeout(() => {
      this.backgroundTimers.delete(key);
      if (this.desiredKeys.has(key) && !this.disposed) void this.ensureDownload(asset);
    }, this.options.backgroundRetryDelayMs);
    this.backgroundTimers.set(key, timer);
  }

  private async discardSupersededPartials(desired: ReadonlySet<string>) {
    const partials = await this.storage.listPartials();
    await Promise.all(partials
      .filter(partial => !desired.has(partial.storageKey))
      .map(partial => this.storage.discardPartial(partialDescriptor(partial))));
  }

  private summarize(assets: AssetSyncResult[]): SyncResult {
    const available = assets.filter(asset => asset.status === 'AVAILABLE').length;
    const downloaded = assets.filter(asset => asset.status === 'DOWNLOADED').length;
    const failed = assets.filter(asset => asset.status === 'FAILED').length;
    const cancelled = assets.filter(asset => asset.status === 'CANCELLED').length;
    return {
      assets,
      available,
      downloaded,
      failed,
      cancelled,
      allDownloaded: failed === 0 && cancelled === 0,
      ready: false,
    };
  }

  private result(
    asset: MediaAssetDescriptor,
    status: AssetSyncResult['status'],
    receivedBytes: number,
    error: string | null,
  ): AssetSyncResult {
    return {
      assetId: asset.assetId,
      binaryId: asset.binaryId,
      binaryVersion: asset.binaryVersion,
      status,
      receivedBytes,
      error,
    };
  }

  private log(event: string, asset: MediaAssetDescriptor, details: Record<string, unknown>) {
    console.info('[media-sync]', JSON.stringify({
      event,
      assetId: asset.assetId,
      binaryId: asset.binaryId,
      binaryVersion: asset.binaryVersion,
      ...details,
    }));
  }
}

const managerRegistry = new WeakMap<MediaStorage, BrowserMediaDownloadManager>();

/** One manager per storage instance is the page-runtime enforcement point for single-owner tasks. */
export function getBrowserMediaDownloadManager(
  storage: MediaStorage,
  options: MediaDownloadManagerOptions = {},
): BrowserMediaDownloadManager {
  const existing = managerRegistry.get(storage);
  if (existing) return existing;
  const manager = new BrowserMediaDownloadManager(storage, options);
  managerRegistry.set(storage, manager);
  return manager;
}

export function disposeBrowserMediaDownloadManager(storage: MediaStorage): void {
  managerRegistry.get(storage)?.dispose();
}
