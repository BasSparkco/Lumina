import type { PlayerAssetManifestItem } from '@lumina/types';
import type { MediaVerificationStage } from '../media-storage/types';

export type DownloadPool = 'large' | 'lightweight';
export type DownloadStatus =
  | 'CHECKING'
  | 'QUEUED'
  | 'DOWNLOADING'
  | 'RETRY_WAIT'
  | 'DOWNLOADED'
  | 'AVAILABLE'
  | 'FAILED'
  | 'CANCELLED';

export interface DownloadProgress {
  key: string;
  assetId: string;
  binaryId: string;
  binaryVersion: string;
  type: PlayerAssetManifestItem['type'];
  priority: PlayerAssetManifestItem['priority'];
  pool: DownloadPool;
  status: DownloadStatus;
  receivedBytes: number;
  totalBytes: number;
  percent: number;
  attempt: number;
  maxAttempts: number;
  nextRetryAt: number | null;
  error: string | null;
  updatedAt: number;
}

export interface AssetSyncResult {
  assetId: string;
  binaryId: string;
  binaryVersion: string;
  status: 'AVAILABLE' | 'DOWNLOADED' | 'FAILED' | 'CANCELLED';
  receivedBytes: number;
  error: string | null;
}

export interface SyncResult {
  assets: AssetSyncResult[];
  available: number;
  downloaded: number;
  failed: number;
  cancelled: number;
  allDownloaded: boolean;
  /** Remains false until Phase 5 verifies checksums and promotes every staged binary. */
  ready: false;
}

export interface MediaDownloadManagerOptions {
  largeConcurrency?: number;
  lightweightConcurrency?: number;
  largeFileThresholdBytes?: number;
  startupJitterMaxMs?: number;
  retryDelaysMs?: readonly number[];
  backgroundRetryDelayMs?: number;
  connectionTimeoutMs?: number;
  noProgressTimeoutMs?: number;
  baseAttemptTimeoutMs?: number;
  minimumThroughputBytesPerSecond?: number;
  maxAttemptTimeoutMs?: number;
  fetch?: typeof fetch;
  random?: () => number;
  now?: () => number;
}

export interface MediaDownloadManager {
  synchronize(manifest: readonly PlayerAssetManifestItem[]): Promise<SyncResult>;
  cancel(assetId: string): Promise<void>;
  getProgress(): DownloadProgress[];
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

export interface VerifiedAssetSyncResult {
  assetId: string;
  binaryId: string;
  binaryVersion: string;
  status: 'VERIFIED' | 'FAILED' | 'CANCELLED';
  verificationStage: MediaVerificationStage | null;
  error: string | null;
}

export interface VerifiedSyncResult {
  assets: VerifiedAssetSyncResult[];
  verified: number;
  failed: number;
  cancelled: number;
  ready: boolean;
}

export interface VerifiedMediaSynchronizer {
  synchronize(manifest: readonly PlayerAssetManifestItem[]): Promise<VerifiedSyncResult>;
  cancel(assetId: string): Promise<void>;
  dispose(): void;
}
