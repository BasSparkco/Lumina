import type {
  CleanupPolicy,
  CleanupResult,
  LocalMediaLease,
  MediaAssetDescriptor,
  MediaStorage,
  MediaVerificationStage,
  PartialWriteOptions,
  StorageUsage,
  StoredMediaAsset,
  StoredMediaFailure,
  StoredMediaPartial,
  VerifiedMediaEvidence,
} from './types';
import {
  getLogicalAssetVersions,
  getMediaMetadataDb,
  getNamespaceAssets,
  getNamespaceFailures,
  getNamespacePartials,
} from './metadata-db';
import { mediaStorageKey } from './identity';
import { planMediaCleanup } from './cleanup-policy.js';

const MEDIA_DIRECTORY = 'media-v1';

interface UriEntry {
  uri: string;
  references: number;
}

function safeFilePart(value: string): string {
  // Percent-encoding is filesystem-safe and injective. Replacing '%' would make values such as
  // ':' and the literal string '_3A' collide into the same OPFS filename.
  return encodeURIComponent(value);
}

function partialPhysicalName(asset: MediaAssetDescriptor): string {
  return `${safeFilePart(asset.namespace)}--${safeFilePart(asset.binaryId)}--${safeFilePart(asset.binaryVersion)}.part`;
}

function namespacePrefix(namespace: string): string {
  return `${safeFilePart(namespace)}--`;
}

function assertValidAsset(asset: MediaAssetDescriptor) {
  if (!asset.namespace || !asset.assetId || !asset.binaryId || !asset.binaryVersion) {
    throw new Error('Media asset identity is incomplete');
  }
  if (!Number.isSafeInteger(asset.fileSize) || asset.fileSize <= 0) {
    throw new Error(`Invalid expected size for media binary ${asset.binaryId}`);
  }
  if (!/^[a-f0-9]{64}$/i.test(asset.sha256)) {
    throw new Error(`Invalid SHA-256 metadata for media binary ${asset.binaryId}`);
  }
}

async function removeFile(directory: FileSystemDirectoryHandle, name: string): Promise<void> {
  try {
    await directory.removeEntry(name);
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
  }
}

/**
 * Disk-backed Chromium media storage. Bytes live in OPFS and only compact identity/lifecycle
 * metadata lives in IndexedDB. A file is discoverable by playback only after its metadata record
 * commits, so a crash during createWritable() leaves an orphan that reconciliation can remove.
 */
export class OpfsMediaStorage implements MediaStorage {
  readonly namespace: string;
  private directoryPromise: Promise<FileSystemDirectoryHandle> | null = null;
  private readonly objectUris = new Map<string, UriEntry>();
  private disposed = false;

  constructor(namespace: string) {
    if (!namespace) throw new Error('A screen namespace is required for persistent media storage');
    this.namespace = namespace;
  }

  static isSupported(): boolean {
    return typeof navigator !== 'undefined'
      && 'storage' in navigator
      && typeof navigator.storage.getDirectory === 'function';
  }

  private getDirectory(): Promise<FileSystemDirectoryHandle> {
    if (!OpfsMediaStorage.isSupported()) throw new Error('OPFS is not supported by this browser');
    this.directoryPromise ??= navigator.storage.getDirectory()
      .then(root => root.getDirectoryHandle(MEDIA_DIRECTORY, { create: true }));
    return this.directoryPromise;
  }

  async initialize(): Promise<StorageUsage> {
    await this.getDirectory();
    await this.requestPersistence();
    await this.reconcile();
    return this.getUsage();
  }

  async exists(asset: MediaAssetDescriptor): Promise<boolean> {
    assertValidAsset(asset);
    if (asset.namespace !== this.namespace) return false;
    const key = mediaStorageKey(asset.namespace, asset);
    const database = await getMediaMetadataDb();
    const stored = await database.get('assets', key);
    if (stored?.verificationStatus !== 'VERIFIED'
      || stored.fileSize !== asset.fileSize
      || stored.sha256 !== asset.sha256.toLowerCase()) {
      if (stored && (this.objectUris.get(key)?.references ?? 0) === 0) {
        await this.removeRecord(stored, false);
      }
      return false;
    }

    const directory = await this.getDirectory();
    try {
      const file = await (await directory.getFileHandle(stored.physicalName)).getFile();
      if (file.size === stored.fileSize) return true;
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
    }

    // A prepared/playing slot owns the current Blob URL. Preserve that lease even if an external
    // storage-pressure event changed the backing entry; the recovery layer may finish or switch
    // the slot, then a later reconciliation pass can remove the broken record safely.
    if ((this.objectUris.get(key)?.references ?? 0) > 0) return true;
    await database.delete('assets', key);
    await removeFile(directory, stored.physicalName);
    this.revokeUri(key, false);
    return false;
  }

  async getLocalUri(asset: MediaAssetDescriptor): Promise<string | null> {
    if (!(await this.exists(asset))) return null;
    const key = mediaStorageKey(asset.namespace, asset);
    const existing = this.objectUris.get(key);
    if (existing) return existing.uri;

    const database = await getMediaMetadataDb();
    const stored = await database.get('assets', key);
    if (!stored) return null;
    const directory = await this.getDirectory();
    const file = await (await directory.getFileHandle(stored.physicalName)).getFile();
    const uri = URL.createObjectURL(file);
    this.objectUris.set(key, { uri, references: 0 });
    await database.put('assets', { ...stored, lastUsedAt: Date.now() });
    return uri;
  }

  async acquireLocalUri(asset: MediaAssetDescriptor): Promise<LocalMediaLease | null> {
    const uri = await this.getLocalUri(asset);
    if (!uri) return null;
    const key = mediaStorageKey(asset.namespace, asset);
    const entry = this.objectUris.get(key);
    if (!entry) return null;
    entry.references += 1;
    let released = false;
    return {
      uri,
      release: () => {
        if (released) return;
        released = true;
        const current = this.objectUris.get(key);
        if (current) current.references = Math.max(0, current.references - 1);
      },
    };
  }

  async getPartial(asset: MediaAssetDescriptor): Promise<StoredMediaPartial | null> {
    assertValidAsset(asset);
    if (asset.namespace !== this.namespace) return null;
    const database = await getMediaMetadataDb();
    const partial = await database.get('partials', mediaStorageKey(asset.namespace, asset));
    if (!partial) return null;
    const directory = await this.getDirectory();
    try {
      const file = await (await directory.getFileHandle(partial.physicalName)).getFile();
      if (file.size > partial.expectedBytes) {
        await this.discardPartial(asset);
        return null;
      }
      if (file.size !== partial.receivedBytes) {
        const recovered = {
          ...partial,
          receivedBytes: file.size,
          status: file.size === partial.expectedBytes ? 'DOWNLOADED' as const : 'FAILED' as const,
          lastError: 'Recovered partial byte count after an interrupted metadata commit',
          updatedAt: Date.now(),
        };
        await database.put('partials', recovered);
        return recovered;
      }
      return partial;
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
      await database.delete('partials', partial.storageKey);
      return null;
    }
  }

  async listPartials(): Promise<StoredMediaPartial[]> {
    return (await getNamespacePartials(this.namespace)).sort((a, b) => a.updatedAt - b.updatedAt);
  }

  async writePartial(
    asset: MediaAssetDescriptor,
    data: ReadableStream<Uint8Array>,
    options: PartialWriteOptions,
  ): Promise<StoredMediaPartial> {
    if (this.disposed) throw new Error('Persistent media storage has been disposed');
    assertValidAsset(asset);
    if (asset.namespace !== this.namespace) throw new Error(`Media namespace mismatch: expected ${this.namespace}`);

    const key = mediaStorageKey(asset.namespace, asset);
    const database = await getMediaMetadataDb();
    const existing = await this.getPartial(asset);
    if (options.offset !== (existing?.receivedBytes ?? 0)) {
      throw new Error(`Partial offset mismatch for ${asset.binaryId}`);
    }
    if (existing && existing.validator !== options.validator) {
      throw new Error(`Partial validator mismatch for ${asset.binaryId}`);
    }

    const directory = await this.getDirectory();
    const name = existing?.physicalName ?? partialPhysicalName(asset);
    const handle = await directory.getFileHandle(name, { create: true });
    const now = Date.now();
    const base: StoredMediaPartial = existing ?? {
      storageKey: key,
      namespace: asset.namespace,
      assetId: asset.assetId,
      binaryId: asset.binaryId,
      binaryVersion: asset.binaryVersion,
      sha256: asset.sha256.toLowerCase(),
      mimeType: asset.mimeType,
      expectedBytes: asset.fileSize,
      receivedBytes: 0,
      physicalName: name,
      validator: options.validator,
      status: 'DOWNLOADING',
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };
    await database.put('partials', { ...base, status: 'DOWNLOADING', lastError: null, updatedAt: now });

    let writable: FileSystemWritableFileStream;
    try {
      writable = await handle.createWritable({ keepExistingData: options.offset > 0 });
      if (options.offset > 0) await writable.seek(options.offset);
    } catch (error) {
      const failed: StoredMediaPartial = {
        ...base,
        status: 'FAILED',
        lastError: error instanceof Error ? error.message : String(error),
        updatedAt: Date.now(),
      };
      await database.put('partials', failed);
      throw error;
    }
    const reader = data.getReader();
    const abortWrite = () => { void writable.abort(options.signal?.reason).catch(() => undefined); };
    if (options.signal?.aborted) abortWrite();
    options.signal?.addEventListener('abort', abortWrite, { once: true });
    let receivedBytes = options.offset;
    try {
      while (true) {
        if (options.signal?.aborted) {
          throw options.signal.reason instanceof Error
            ? options.signal.reason
            : new DOMException('Partial write aborted', 'AbortError');
        }
        const result = await reader.read();
        if (result.done) break;
        if (receivedBytes + result.value.byteLength > asset.fileSize) {
          throw new Error(`Download exceeded expected size for ${asset.binaryId}`);
        }
        const chunk = new Uint8Array(result.value.byteLength);
        chunk.set(result.value);
        await writable.write(chunk);
        receivedBytes += chunk.byteLength;
        options.onProgress?.(receivedBytes);
      }
      await writable.close();
    } catch (error) {
      // OPFS writable streams are transactional. Closing commits every complete chunk received in
      // this attempt so a later Range request can resume; aborting would roll all of them back.
      try {
        await writable.close();
      } catch {
        await writable.abort().catch(() => undefined);
      }
      const file = await handle.getFile().catch(() => null);
      const durableBytes = file?.size ?? options.offset;
      const failed: StoredMediaPartial = {
        ...base,
        receivedBytes: durableBytes,
        status: 'FAILED',
        lastError: error instanceof Error ? error.message : String(error),
        updatedAt: Date.now(),
      };
      await database.put('partials', failed);
      throw error;
    } finally {
      options.signal?.removeEventListener('abort', abortWrite);
      reader.releaseLock();
    }

    const file = await handle.getFile();
    if (file.size !== receivedBytes) throw new Error(`OPFS partial commit size mismatch for ${asset.binaryId}`);
    const completed: StoredMediaPartial = {
      ...base,
      receivedBytes,
      status: receivedBytes === asset.fileSize ? 'DOWNLOADED' : 'DOWNLOADING',
      lastError: null,
      updatedAt: Date.now(),
    };
    await database.put('partials', completed);
    return completed;
  }

  async discardPartial(asset: MediaAssetDescriptor): Promise<void> {
    const key = mediaStorageKey(asset.namespace, asset);
    const database = await getMediaMetadataDb();
    const partial = await database.get('partials', key);
    if (!partial) return;
    this.revokeUri(`partial:${key}`, true);
    const directory = await this.getDirectory();
    await removeFile(directory, partial.physicalName);
    await database.delete('partials', key);
  }

  async openPartialStream(asset: MediaAssetDescriptor): Promise<ReadableStream<Uint8Array> | null> {
    const partial = await this.getPartial(asset);
    if (!partial) return null;
    const directory = await this.getDirectory();
    const file = await (await directory.getFileHandle(partial.physicalName)).getFile();
    return file.stream();
  }

  async acquirePartialUri(asset: MediaAssetDescriptor): Promise<LocalMediaLease | null> {
    const partial = await this.getPartial(asset);
    if (!partial) return null;
    const uriKey = `partial:${partial.storageKey}`;
    let entry = this.objectUris.get(uriKey);
    if (!entry) {
      const directory = await this.getDirectory();
      const file = await (await directory.getFileHandle(partial.physicalName)).getFile();
      entry = { uri: URL.createObjectURL(file), references: 0 };
      this.objectUris.set(uriKey, entry);
    }
    entry.references += 1;
    let released = false;
    return {
      uri: entry.uri,
      release: () => {
        if (released) return;
        released = true;
        const current = this.objectUris.get(uriKey);
        if (!current) return;
        current.references = Math.max(0, current.references - 1);
        this.revokeUri(uriKey, false);
      },
    };
  }

  async commitVerifiedPartial(asset: MediaAssetDescriptor, evidence: VerifiedMediaEvidence): Promise<string> {
    assertValidAsset(asset);
    if (evidence.sha256.toLowerCase() !== asset.sha256.toLowerCase()
      || evidence.fileSize !== asset.fileSize
      || evidence.mimeType.toLowerCase() !== asset.mimeType.toLowerCase()
      || evidence.readable !== true
      || !Number.isFinite(evidence.verifiedAt)) {
      throw new Error(`Invalid verification evidence for media binary ${asset.binaryId}`);
    }
    const partial = await this.getPartial(asset);
    if (partial?.receivedBytes !== asset.fileSize || partial.status !== 'DOWNLOADED') {
      throw new Error(`Media binary ${asset.binaryId} has no complete staged download`);
    }
    if (partial.expectedBytes !== asset.fileSize
      || partial.sha256 !== asset.sha256.toLowerCase()
      || partial.mimeType.toLowerCase() !== asset.mimeType.toLowerCase()) {
      throw new Error(`Staged metadata does not match media binary ${asset.binaryId}`);
    }
    const now = Date.now();
    const stored: StoredMediaAsset = {
      storageKey: partial.storageKey,
      namespace: asset.namespace,
      assetId: asset.assetId,
      binaryId: asset.binaryId,
      binaryVersion: asset.binaryVersion,
      sha256: asset.sha256.toLowerCase(),
      mimeType: asset.mimeType,
      fileSize: asset.fileSize,
      priority: asset.priority,
      physicalName: partial.physicalName,
      backend: 'opfs',
      verificationStatus: 'VERIFIED',
      verifiedAt: evidence.verifiedAt,
      storedAt: now,
      lastUsedAt: now,
    };
    const database = await getMediaMetadataDb();
    const transaction = database.transaction(['assets', 'partials', 'failures'], 'readwrite');
    await Promise.all([
      transaction.objectStore('assets').put(stored),
      transaction.objectStore('partials').delete(partial.storageKey),
      transaction.objectStore('failures').delete(partial.storageKey),
      transaction.done,
    ]);
    this.revokeUri(`partial:${partial.storageKey}`, true);
    return (await this.getLocalUri(asset))!;
  }

  async recordVerificationFailure(
    asset: MediaAssetDescriptor,
    stage: MediaVerificationStage,
    message: string,
  ): Promise<StoredMediaFailure> {
    const key = mediaStorageKey(asset.namespace, asset);
    const database = await getMediaMetadataDb();
    const existing = await database.get('failures', key);
    const failure: StoredMediaFailure = {
      storageKey: key,
      namespace: asset.namespace,
      assetId: asset.assetId,
      binaryId: asset.binaryId,
      binaryVersion: asset.binaryVersion,
      sha256: asset.sha256.toLowerCase(),
      mimeType: asset.mimeType,
      expectedBytes: asset.fileSize,
      stage,
      message,
      attempts: (existing?.attempts ?? 0) + 1,
      failedAt: Date.now(),
    };
    await database.put('failures', failure);
    return failure;
  }

  async listVerificationFailures(): Promise<StoredMediaFailure[]> {
    return (await getNamespaceFailures(this.namespace)).sort((a, b) => a.failedAt - b.failedAt);
  }

  async remove(assetId: string): Promise<void> {
    const records = await getLogicalAssetVersions(this.namespace, assetId);
    const active = records.find(record => (this.objectUris.get(record.storageKey)?.references ?? 0) > 0);
    if (active) throw new Error(`Cannot remove active media binary ${active.binaryId}`);
    for (const record of records) await this.removeRecord(record, false);
  }

  async list(): Promise<StoredMediaAsset[]> {
    const records = await getNamespaceAssets(this.namespace);
    return records.sort((a, b) => a.lastUsedAt - b.lastUsedAt);
  }

  async getUsage(): Promise<StorageUsage> {
    const records = await getNamespaceAssets(this.namespace);
    const mediaBytes = records.reduce((total, record) => total + record.fileSize, 0);
    let estimate: StorageEstimate = {};
    if (typeof navigator.storage.estimate === 'function') {
      try {
        estimate = await navigator.storage.estimate();
      } catch {
        // Quota telemetry failure degrades observability, not otherwise usable OPFS storage.
      }
    }
    const persisted = typeof navigator.storage.persisted === 'function'
      ? await navigator.storage.persisted().catch(() => false)
      : false;
    const originUsageBytes = estimate.usage ?? null;
    const quotaBytes = estimate.quota ?? null;
    return {
      backend: 'opfs',
      mediaBytes,
      originUsageBytes,
      quotaBytes,
      availableBytes: quotaBytes === null || originUsageBytes === null
        ? null
        : Math.max(0, quotaBytes - originUsageBytes),
      persisted,
      persistenceSupported: typeof navigator.storage.persist === 'function',
    };
  }

  async cleanup(policy: CleanupPolicy): Promise<CleanupResult> {
    const records = await this.list();
    const activeStorageKeys = new Set(
      [...this.objectUris.entries()]
        .filter(([, entry]) => entry.references > 0)
        .map(([storageKey]) => storageKey),
    );
    const plan = planMediaCleanup(records, policy, activeStorageKeys);
    const byStorageKey = new Map(records.map(record => [record.storageKey, record]));
    for (const storageKey of plan.removedStorageKeys) {
      const record = byStorageKey.get(storageKey);
      if (record) await this.removeRecord(record, false);
    }
    return plan;
  }

  async reconcile(): Promise<void> {
    const directory = await this.getDirectory();
    const database = await getMediaMetadataDb();
    const records = await getNamespaceAssets(this.namespace);
    const partials = await getNamespacePartials(this.namespace);
    const knownNames = new Set([
      ...records.map(record => record.physicalName),
      ...partials.map(partial => partial.physicalName),
    ]);

    for (const record of records) {
      if (record.verificationStatus !== 'VERIFIED') {
        if ((this.objectUris.get(record.storageKey)?.references ?? 0) === 0) {
          await this.removeRecord(record, false);
        }
        continue;
      }
      try {
        const file = await (await directory.getFileHandle(record.physicalName)).getFile();
        if (file.size !== record.fileSize
          && (this.objectUris.get(record.storageKey)?.references ?? 0) === 0) {
          await this.removeRecord(record, false);
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
        if ((this.objectUris.get(record.storageKey)?.references ?? 0) > 0) continue;
        await database.delete('assets', record.storageKey);
        this.revokeUri(record.storageKey, false);
      }
    }

    for (const partial of partials) {
      const descriptor: MediaAssetDescriptor = {
        namespace: partial.namespace,
        assetId: partial.assetId,
        binaryId: partial.binaryId,
        binaryVersion: partial.binaryVersion,
        sha256: partial.sha256,
        mimeType: partial.mimeType,
        fileSize: partial.expectedBytes,
        priority: 'fallback',
        type: 'other',
        remoteUrl: '',
        networkRequired: false,
      };
      await this.getPartial(descriptor);
    }

    // Files are written before their IndexedDB commit. A crash between those steps leaves an
    // unreachable orphan; remove only this screen namespace's orphans, never another namespace.
    for await (const name of directory.keys()) {
      if (name.startsWith(namespacePrefix(this.namespace)) && !knownNames.has(name)) {
        await removeFile(directory, name);
      }
    }
  }

  async requestPersistence(): Promise<boolean> {
    if (typeof navigator.storage.persist !== 'function') return false;
    return navigator.storage.persist().catch(() => false);
  }

  dispose(): void {
    this.disposed = true;
    for (const entry of this.objectUris.values()) URL.revokeObjectURL(entry.uri);
    this.objectUris.clear();
  }

  private async removeRecord(record: StoredMediaAsset, force: boolean): Promise<void> {
    const references = this.objectUris.get(record.storageKey)?.references ?? 0;
    if (!force && references > 0) {
      throw new Error(`Cannot remove active media binary ${record.binaryId}`);
    }
    const directory = await this.getDirectory();
    await removeFile(directory, record.physicalName);
    const database = await getMediaMetadataDb();
    await database.delete('assets', record.storageKey);
    this.revokeUri(record.storageKey, force);
  }

  private revokeUri(storageKey: string, force: boolean) {
    const entry = this.objectUris.get(storageKey);
    if (!entry || (!force && entry.references > 0)) return;
    URL.revokeObjectURL(entry.uri);
    this.objectUris.delete(storageKey);
  }
}

export async function clearOpfsMediaDirectory(): Promise<void> {
  if (!OpfsMediaStorage.isSupported()) return;
  const root = await navigator.storage.getDirectory();
  try {
    await root.removeEntry(MEDIA_DIRECTORY, { recursive: true });
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
  }
}
