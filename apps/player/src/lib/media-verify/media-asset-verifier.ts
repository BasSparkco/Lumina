import type {
  MediaAssetDescriptor,
  MediaStorage,
  MediaVerificationStage,
} from '../media-storage/types';
import { IncrementalSha256 } from './incremental-sha256.js';
import { matchesExpectedMime } from './mime-signature.js';
import { probeMediaReadability } from './readability-probe.js';
import type {
  MediaAssetVerifier,
  MediaAssetVerifierOptions,
  MediaVerificationResult,
} from './types';

const SNIFF_BYTES = 512;

class VerificationError extends Error {
  constructor(readonly stage: MediaVerificationStage, message: string) {
    super(message);
  }
}

function identityKey(asset: MediaAssetDescriptor): string {
  return `${asset.namespace}/${asset.assetId}/${asset.binaryId}/${asset.binaryVersion}`;
}

function needsDecoderProbe(asset: MediaAssetDescriptor): boolean {
  return asset.type === 'video' || asset.type === 'audio'
    || asset.type === 'image' || asset.type === 'document-page';
}

/** The only component authorized to promote a staged OPFS binary into playable storage. */
export class BrowserMediaAssetVerifier implements MediaAssetVerifier {
  private readonly inFlight = new Map<string, Promise<MediaVerificationResult>>();
  private readonly readabilityProbe;
  private readonly now;

  constructor(private readonly storage: MediaStorage, options: MediaAssetVerifierOptions = {}) {
    this.readabilityProbe = options.readabilityProbe ?? probeMediaReadability;
    this.now = options.now ?? Date.now;
  }

  verify(asset: MediaAssetDescriptor): Promise<MediaVerificationResult> {
    const key = identityKey(asset);
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const operation = this.verifyOnce(asset).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, operation);
    return operation;
  }

  private async verifyOnce(asset: MediaAssetDescriptor): Promise<MediaVerificationResult> {
    let computedSha256: string | null = null;
    try {
      if (await this.storage.exists(asset)) {
        const localUri = await this.storage.getLocalUri(asset);
        if (!localUri) throw new VerificationError('STORAGE', `Verified media ${asset.binaryId} is not readable`);
        return this.success(asset, asset.sha256.toLowerCase(), localUri);
      }
      const partial = await this.storage.getPartial(asset);
      if (partial?.status !== 'DOWNLOADED' || partial.receivedBytes !== asset.fileSize) {
        throw new VerificationError('SIZE', `Media binary ${asset.binaryId} has no complete staged file`);
      }
      if (partial.expectedBytes !== asset.fileSize) {
        throw new VerificationError('SIZE', `Expected ${asset.fileSize} bytes, staged ${partial.expectedBytes}`);
      }

      const stream = await this.storage.openPartialStream(asset);
      if (!stream) throw new VerificationError('STORAGE', `Staged bytes are missing for ${asset.binaryId}`);
      const reader = stream.getReader();
      const hash = new IncrementalSha256();
      const prefix = new Uint8Array(Math.min(SNIFF_BYTES, asset.fileSize));
      let prefixLength = 0;
      let totalBytes = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          totalBytes += chunk.value.byteLength;
          if (totalBytes > asset.fileSize) {
            throw new VerificationError('SIZE', `Staged file exceeds ${asset.fileSize} bytes`);
          }
          hash.update(chunk.value);
          if (prefixLength < prefix.byteLength) {
            const length = Math.min(prefix.byteLength - prefixLength, chunk.value.byteLength);
            prefix.set(chunk.value.subarray(0, length), prefixLength);
            prefixLength += length;
          }
        }
      } finally {
        reader.releaseLock();
      }
      if (totalBytes !== asset.fileSize) {
        throw new VerificationError('SIZE', `Expected ${asset.fileSize} bytes, read ${totalBytes}`);
      }
      computedSha256 = hash.digestHex();
      if (computedSha256 !== asset.sha256.toLowerCase()) {
        throw new VerificationError('CHECKSUM', `SHA-256 mismatch for ${asset.binaryId}`);
      }
      if (!matchesExpectedMime(prefix.subarray(0, prefixLength), asset.mimeType)) {
        throw new VerificationError('MIME', `File signature does not match ${asset.mimeType}`);
      }

      if (needsDecoderProbe(asset)) {
        const lease = await this.storage.acquirePartialUri(asset);
        if (!lease) throw new VerificationError('STORAGE', `Cannot open staged media ${asset.binaryId}`);
        try {
          await this.readabilityProbe(asset, lease.uri);
        } catch (error) {
          throw new VerificationError(
            'READABILITY',
            error instanceof Error ? error.message : `Decoder rejected ${asset.binaryId}`,
          );
        } finally {
          lease.release();
        }
      }

      const verifiedAt = this.now();
      const localUri = await this.storage.commitVerifiedPartial(asset, {
        sha256: computedSha256,
        mimeType: asset.mimeType,
        fileSize: totalBytes,
        readable: true,
        verifiedAt,
      });
      this.log('verification-complete', asset, { bytes: totalBytes, sha256: computedSha256 });
      return this.success(asset, computedSha256, localUri);
    } catch (error) {
      const stage = error instanceof VerificationError ? error.stage : 'STORAGE';
      const message = error instanceof Error ? error.message : String(error);
      await this.storage.discardPartial(asset).catch(() => undefined);
      const failure = await this.storage.recordVerificationFailure(asset, stage, message).catch(() => null);
      this.log('verification-failed', asset, {
        stage,
        error: message,
        attempts: failure?.attempts ?? null,
      });
      return {
        assetId: asset.assetId,
        binaryId: asset.binaryId,
        binaryVersion: asset.binaryVersion,
        status: 'FAILED',
        fileSize: asset.fileSize,
        sha256: computedSha256,
        localUri: null,
        stage,
        error: message,
      };
    }
  }

  private success(asset: MediaAssetDescriptor, sha256: string, localUri: string | null): MediaVerificationResult {
    return {
      assetId: asset.assetId,
      binaryId: asset.binaryId,
      binaryVersion: asset.binaryVersion,
      status: 'VERIFIED',
      fileSize: asset.fileSize,
      sha256,
      localUri,
      stage: null,
      error: null,
    };
  }

  private log(event: string, asset: MediaAssetDescriptor, details: Record<string, unknown>) {
    console.info('[media-verification]', JSON.stringify({
      event,
      assetId: asset.assetId,
      binaryId: asset.binaryId,
      binaryVersion: asset.binaryVersion,
      ...details,
    }));
  }
}
