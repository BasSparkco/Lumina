import type { PlayerAssetManifestItem } from '@lumina/types';

export type MediaStorageState = 'INITIALIZING' | 'READY' | 'DEGRADED' | 'UNAVAILABLE';

export interface MediaAssetDescriptor extends PlayerAssetManifestItem {
  /** Screen namespace. Prevents one paired screen from reusing another screen's local files. */
  namespace: string;
}

export interface StoredMediaAsset {
  storageKey: string;
  namespace: string;
  assetId: string;
  binaryId: string;
  binaryVersion: string;
  sha256: string;
  mimeType: string;
  fileSize: number;
  priority: PlayerAssetManifestItem['priority'];
  physicalName: string;
  backend: 'opfs';
  verificationStatus: 'VERIFIED';
  verifiedAt: number;
  storedAt: number;
  lastUsedAt: number;
}

export interface StoredActivePresentation {
  namespace: string;
  contentRevision: string;
  sourceState: unknown;
  assets: PlayerAssetManifestItem[];
  assetStorageKeys: string[];
  activatedAt: number;
}

export type MediaVerificationStage = 'SIZE' | 'CHECKSUM' | 'MIME' | 'READABILITY' | 'STORAGE';

export interface StoredMediaFailure {
  storageKey: string;
  namespace: string;
  assetId: string;
  binaryId: string;
  binaryVersion: string;
  sha256: string;
  mimeType: string;
  expectedBytes: number;
  stage: MediaVerificationStage;
  message: string;
  attempts: number;
  failedAt: number;
}

export interface VerifiedMediaEvidence {
  sha256: string;
  mimeType: string;
  fileSize: number;
  readable: true;
  verifiedAt: number;
}

export type PartialMediaStatus = 'DOWNLOADING' | 'DOWNLOADED' | 'FAILED';

export interface StoredMediaPartial {
  storageKey: string;
  namespace: string;
  assetId: string;
  binaryId: string;
  binaryVersion: string;
  sha256: string;
  mimeType: string;
  expectedBytes: number;
  receivedBytes: number;
  physicalName: string;
  validator: string | null;
  status: PartialMediaStatus;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface StorageUsage {
  backend: 'opfs';
  mediaBytes: number;
  originUsageBytes: number | null;
  quotaBytes: number | null;
  availableBytes: number | null;
  persisted: boolean;
  persistenceSupported: boolean;
}

export interface CleanupPolicy {
  /** Asset versions that must never be evicted, such as active/candidate presentation assets. */
  retainStorageKeys?: ReadonlySet<string>;
  /** Evict least-recently-used unretained media until the media store is at or below this size. */
  maxMediaBytes?: number;
  /** Evict unretained media that has not been used within this interval. */
  maxUnusedMs?: number;
}

export interface CleanupResult {
  removedStorageKeys: string[];
  removedBytes: number;
  remainingBytes: number;
}

export interface PartialWriteOptions {
  offset: number;
  validator: string | null;
  signal?: AbortSignal;
  onProgress?: (receivedBytes: number) => void;
}

export interface LocalMediaLease {
  uri: string;
  release(): void;
}

export interface MediaStorage {
  readonly namespace: string;

  initialize(): Promise<StorageUsage>;
  exists(asset: MediaAssetDescriptor): Promise<boolean>;
  getLocalUri(asset: MediaAssetDescriptor): Promise<string | null>;
  acquireLocalUri(asset: MediaAssetDescriptor): Promise<LocalMediaLease | null>;
  getPartial(asset: MediaAssetDescriptor): Promise<StoredMediaPartial | null>;
  listPartials(): Promise<StoredMediaPartial[]>;
  writePartial(
    asset: MediaAssetDescriptor,
    data: ReadableStream<Uint8Array>,
    options: PartialWriteOptions,
  ): Promise<StoredMediaPartial>;
  openPartialStream(asset: MediaAssetDescriptor): Promise<ReadableStream<Uint8Array> | null>;
  acquirePartialUri(asset: MediaAssetDescriptor): Promise<LocalMediaLease | null>;
  discardPartial(asset: MediaAssetDescriptor): Promise<void>;
  commitVerifiedPartial(asset: MediaAssetDescriptor, evidence: VerifiedMediaEvidence): Promise<string>;
  recordVerificationFailure(
    asset: MediaAssetDescriptor,
    stage: MediaVerificationStage,
    message: string,
  ): Promise<StoredMediaFailure>;
  listVerificationFailures(): Promise<StoredMediaFailure[]>;
  remove(assetId: string): Promise<void>;
  list(): Promise<StoredMediaAsset[]>;
  getUsage(): Promise<StorageUsage>;
  cleanup(policy: CleanupPolicy): Promise<CleanupResult>;
  reconcile(): Promise<void>;
  requestPersistence(): Promise<boolean>;
  dispose(): void;
}

export interface MediaStorageDiagnostic {
  state: MediaStorageState;
  namespace: string | null;
  persisted: boolean | null;
  mediaBytes: number;
  quotaBytes: number | null;
  message: string;
}
