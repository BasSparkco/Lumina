import type { PlayerAssetManifestItem } from '@lumina/types';

export function mediaStorageKey(
  namespace: string,
  asset: Pick<PlayerAssetManifestItem, 'assetId' | 'binaryId' | 'binaryVersion'>,
): string {
  return `${namespace}/${asset.assetId}/${asset.binaryId}/${asset.binaryVersion}`;
}
