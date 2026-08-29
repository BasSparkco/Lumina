import { clearAllMetadata } from './metadata-db';
import { clearOpfsMediaDirectory, OpfsMediaStorage } from './opfs-media-storage';
import type { MediaStorage, MediaStorageDiagnostic } from './types';

export type {
  CleanupPolicy,
  CleanupResult,
  LocalMediaLease,
  MediaAssetDescriptor,
  MediaStorage,
  MediaStorageDiagnostic,
  MediaStorageState,
  MediaVerificationStage,
  PartialMediaStatus,
  PartialWriteOptions,
  StorageUsage,
  StoredMediaAsset,
  StoredActivePresentation,
  StoredMediaFailure,
  StoredMediaPartial,
  VerifiedMediaEvidence,
} from './types';
export { mediaStorageKey } from './identity';

const listeners = new Set<() => void>();
let activeStorage: MediaStorage | null = null;
let initialization: Promise<MediaStorage | null> | null = null;
let diagnostic: MediaStorageDiagnostic = {
  state: 'INITIALIZING',
  namespace: null,
  persisted: null,
  mediaBytes: 0,
  quotaBytes: null,
  message: 'Persistent media storage has not been initialized',
};

function publish(next: MediaStorageDiagnostic) {
  diagnostic = next;
  if (typeof document !== 'undefined') document.documentElement.dataset.mediaStorageState = next.state;
  for (const listener of listeners) listener();
  if (next.state === 'READY') console.info('[media-storage]', JSON.stringify(next));
  else console.warn('[media-storage]', JSON.stringify(next));
}

export function subscribeMediaStorageDiagnostic(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getMediaStorageDiagnostic(): MediaStorageDiagnostic {
  return diagnostic;
}

export function getActiveMediaStorage(): MediaStorage | null {
  return activeStorage;
}

export function initializeMediaStorage(namespace: string): Promise<MediaStorage | null> {
  if (activeStorage?.namespace === namespace) return Promise.resolve(activeStorage);
  if (initialization) return initialization;

  publish({
    state: 'INITIALIZING', namespace, persisted: null, mediaBytes: 0, quotaBytes: null,
    message: 'Opening persistent media storage',
  });
  initialization = (async () => {
    activeStorage?.dispose();
    activeStorage = null;
    if (!OpfsMediaStorage.isSupported()) {
      publish({
        state: 'UNAVAILABLE', namespace, persisted: false, mediaBytes: 0, quotaBytes: null,
        message: 'OPFS is unavailable; this browser has not passed the persistent-media requirement',
      });
      return null;
    }

    try {
      const storage = new OpfsMediaStorage(namespace);
      const usage = await storage.initialize();
      activeStorage = storage;
      publish({
        state: usage.persisted ? 'READY' : 'DEGRADED',
        namespace,
        persisted: usage.persisted,
        mediaBytes: usage.mediaBytes,
        quotaBytes: usage.quotaBytes,
        message: usage.persisted
          ? 'OPFS media storage is durable and reconciled'
          : 'OPFS is available, but durable-storage permission was not granted',
      });
      return storage;
    } catch (error) {
      publish({
        state: 'UNAVAILABLE', namespace, persisted: false, mediaBytes: 0, quotaBytes: null,
        message: error instanceof Error ? error.message : 'Persistent media storage failed to initialize',
      });
      return null;
    }
  })().finally(() => {
    initialization = null;
  });
  return initialization;
}

export async function clearAllPersistentMedia(): Promise<void> {
  if (initialization) await initialization;
  activeStorage?.dispose();
  activeStorage = null;
  await Promise.all([clearAllMetadata(), clearOpfsMediaDirectory()]);
  publish({
    state: 'INITIALIZING', namespace: null, persisted: null, mediaBytes: 0, quotaBytes: null,
    message: 'Persistent media storage was cleared',
  });
}
