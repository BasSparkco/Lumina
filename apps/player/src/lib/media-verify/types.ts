import type { MediaAssetDescriptor, MediaVerificationStage } from '../media-storage/types';

export type VerificationStatus = 'VERIFIED' | 'FAILED';

export interface MediaVerificationResult {
  assetId: string;
  binaryId: string;
  binaryVersion: string;
  status: VerificationStatus;
  fileSize: number;
  sha256: string | null;
  localUri: string | null;
  stage: MediaVerificationStage | null;
  error: string | null;
}

export type MediaReadabilityProbe = (asset: MediaAssetDescriptor, uri: string) => Promise<void>;

export interface MediaAssetVerifierOptions {
  readabilityProbe?: MediaReadabilityProbe;
  now?: () => number;
}

export interface MediaAssetVerifier {
  verify(asset: MediaAssetDescriptor): Promise<MediaVerificationResult>;
}
