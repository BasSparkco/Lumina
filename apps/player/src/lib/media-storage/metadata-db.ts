import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  StoredActivePresentation,
  StoredMediaAsset,
  StoredMediaFailure,
  StoredMediaPartial,
} from './types';

const DB_NAME = 'lumina-player-media';
const DB_VERSION = 4;

interface MediaMetadataDB extends DBSchema {
  assets: {
    key: string;
    value: StoredMediaAsset;
    indexes: {
      'by-namespace': string;
      'by-namespace-asset': [string, string];
      'by-last-used': number;
    };
  };
  partials: {
    key: string;
    value: StoredMediaPartial;
    indexes: {
      'by-namespace': string;
      'by-namespace-asset': [string, string];
      'by-updated': number;
    };
  };
  failures: {
    key: string;
    value: StoredMediaFailure;
    indexes: {
      'by-namespace': string;
      'by-failed-at': number;
    };
  };
  activations: {
    key: string;
    value: StoredActivePresentation;
  };
}

let databasePromise: Promise<IDBPDatabase<MediaMetadataDB>> | null = null;

export function getMediaMetadataDb(): Promise<IDBPDatabase<MediaMetadataDB>> {
  databasePromise ??= openDB<MediaMetadataDB>(DB_NAME, DB_VERSION, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) {
        const assets = database.createObjectStore('assets', { keyPath: 'storageKey' });
        assets.createIndex('by-namespace', 'namespace');
        assets.createIndex('by-namespace-asset', ['namespace', 'assetId']);
        assets.createIndex('by-last-used', 'lastUsedAt');
      }
      if (oldVersion < 2) {
        const partials = database.createObjectStore('partials', { keyPath: 'storageKey' });
        partials.createIndex('by-namespace', 'namespace');
        partials.createIndex('by-namespace-asset', ['namespace', 'assetId']);
        partials.createIndex('by-updated', 'updatedAt');
      }
      if (oldVersion < 3) {
        const failures = database.createObjectStore('failures', { keyPath: 'storageKey' });
        failures.createIndex('by-namespace', 'namespace');
        failures.createIndex('by-failed-at', 'failedAt');
      }
      if (oldVersion < 4) {
        database.createObjectStore('activations', { keyPath: 'namespace' });
      }
    },
  });
  return databasePromise;
}

export async function getNamespaceAssets(namespace: string): Promise<StoredMediaAsset[]> {
  const database = await getMediaMetadataDb();
  return database.getAllFromIndex('assets', 'by-namespace', namespace);
}

export async function getLogicalAssetVersions(namespace: string, assetId: string): Promise<StoredMediaAsset[]> {
  const database = await getMediaMetadataDb();
  return database.getAllFromIndex('assets', 'by-namespace-asset', [namespace, assetId]);
}

export async function getNamespacePartials(namespace: string): Promise<StoredMediaPartial[]> {
  const database = await getMediaMetadataDb();
  return database.getAllFromIndex('partials', 'by-namespace', namespace);
}

export async function getNamespaceFailures(namespace: string): Promise<StoredMediaFailure[]> {
  const database = await getMediaMetadataDb();
  return database.getAllFromIndex('failures', 'by-namespace', namespace);
}

export async function getActivePresentation(namespace: string): Promise<StoredActivePresentation | undefined> {
  const database = await getMediaMetadataDb();
  return database.get('activations', namespace);
}

export async function commitActivePresentation(presentation: StoredActivePresentation): Promise<void> {
  if (!presentation.contentRevision || presentation.assetStorageKeys.length !== presentation.assets.length) {
    throw new Error('Active presentation metadata is incomplete');
  }
  const uniqueKeys = new Set(presentation.assetStorageKeys);
  if (uniqueKeys.size !== presentation.assetStorageKeys.length) {
    throw new Error('Active presentation contains duplicate media keys');
  }
  const database = await getMediaMetadataDb();
  const transaction = database.transaction(['assets', 'activations'], 'readwrite');
  const assets = transaction.objectStore('assets');
  const stored = await Promise.all(presentation.assetStorageKeys.map(key => assets.get(key)));
  const invalid = stored.some((asset, index) => {
    const expected = presentation.assets[index];
    return !asset || !expected
      || asset.verificationStatus !== 'VERIFIED'
      || asset.storageKey !== presentation.assetStorageKeys[index]
      || asset.assetId !== expected.assetId
      || asset.binaryId !== expected.binaryId
      || asset.binaryVersion !== expected.binaryVersion
      || asset.fileSize !== expected.fileSize
      || asset.sha256 !== expected.sha256.toLowerCase();
  });
  if (invalid) {
    transaction.abort();
    await transaction.done.catch(() => undefined);
    throw new Error('Active presentation references missing or unverified media');
  }
  await transaction.objectStore('activations').put(presentation);
  await transaction.done;
}

export async function clearAllMetadata(): Promise<void> {
  const database = await getMediaMetadataDb();
  const transaction = database.transaction(['assets', 'partials', 'failures', 'activations'], 'readwrite');
  await Promise.all([
    transaction.objectStore('assets').clear(),
    transaction.objectStore('partials').clear(),
    transaction.objectStore('failures').clear(),
    transaction.objectStore('activations').clear(),
    transaction.done,
  ]);
}
