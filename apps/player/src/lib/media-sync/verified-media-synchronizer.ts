import type { PlayerAssetManifestItem } from '@lumina/types';
import type { MediaAssetDescriptor, MediaStorage } from '../media-storage/types';
import type { MediaAssetVerifier } from '../media-verify/types';
import type {
  AssetSyncResult,
  MediaDownloadManager,
  VerifiedAssetSyncResult,
  VerifiedMediaSynchronizer,
  VerifiedSyncResult,
} from './types';

function identityKey(asset: Pick<PlayerAssetManifestItem, 'assetId' | 'binaryId' | 'binaryVersion'>): string {
  return `${asset.assetId}/${asset.binaryId}/${asset.binaryVersion}`;
}

/** Composes download staging and verification without exposing DOWNLOADED as a ready state. */
export class BrowserVerifiedMediaSynchronizer implements VerifiedMediaSynchronizer {
  constructor(
    private readonly storage: MediaStorage,
    private readonly downloads: MediaDownloadManager,
    private readonly verifier: MediaAssetVerifier,
  ) {}

  async synchronize(manifest: readonly PlayerAssetManifestItem[]): Promise<VerifiedSyncResult> {
    const unique = new Map(manifest.map(asset => [identityKey(asset), asset]));
    const downloaded = await this.downloads.synchronize([...unique.values()]);
    const downloadResults = new Map(downloaded.assets.map(result => [identityKey(result), result]));
    const assets: VerifiedAssetSyncResult[] = [];

    // Verification is deliberately serialized. Streaming one large hash at a time avoids CPU and
    // disk contention with playback on the lowest supported signage hardware.
    for (const asset of unique.values()) {
      const download = downloadResults.get(identityKey(asset));
      if (!download || download.status === 'FAILED' || download.status === 'CANCELLED') {
        assets.push(this.downloadFailure(asset, download));
        continue;
      }
      const descriptor: MediaAssetDescriptor = { ...asset, namespace: this.storage.namespace };
      const verification = await this.verifier.verify(descriptor);
      assets.push({
        assetId: asset.assetId,
        binaryId: asset.binaryId,
        binaryVersion: asset.binaryVersion,
        status: verification.status,
        verificationStage: verification.stage,
        error: verification.error,
      });
    }

    const verified = assets.filter(asset => asset.status === 'VERIFIED').length;
    const failed = assets.filter(asset => asset.status === 'FAILED').length;
    const cancelled = assets.filter(asset => asset.status === 'CANCELLED').length;
    return {
      assets,
      verified,
      failed,
      cancelled,
      ready: verified === assets.length && failed === 0 && cancelled === 0,
    };
  }

  cancel(assetId: string): Promise<void> {
    return this.downloads.cancel(assetId);
  }

  dispose(): void {
    this.downloads.dispose();
  }

  private downloadFailure(
    asset: PlayerAssetManifestItem,
    result: AssetSyncResult | undefined,
  ): VerifiedAssetSyncResult {
    return {
      assetId: asset.assetId,
      binaryId: asset.binaryId,
      binaryVersion: asset.binaryVersion,
      status: result?.status === 'CANCELLED' ? 'CANCELLED' : 'FAILED',
      verificationStage: null,
      error: result?.error ?? 'Download produced no result',
    };
  }
}
