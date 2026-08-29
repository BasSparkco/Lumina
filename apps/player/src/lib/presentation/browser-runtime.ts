import type { MediaStorage } from '../media-storage/types';
import {
  commitActivePresentation,
  getActivePresentation,
} from '../media-storage/metadata-db';
import { getBrowserMediaDownloadManager } from '../media-sync/media-download-manager';
import { BrowserVerifiedMediaSynchronizer } from '../media-sync/verified-media-synchronizer';
import { BrowserMediaAssetVerifier } from '../media-verify/media-asset-verifier';
import { BrowserPresentationActivationCoordinator } from './activation-coordinator';
import { BrowserPresentationPreparer } from './presentation-preparer';

export function createBrowserPresentationActivationCoordinator(
  storage: MediaStorage,
): BrowserPresentationActivationCoordinator {
  const downloads = getBrowserMediaDownloadManager(storage);
  const verifier = new BrowserMediaAssetVerifier(storage);
  const synchronizer = new BrowserVerifiedMediaSynchronizer(storage, downloads, verifier);
  return new BrowserPresentationActivationCoordinator(
    storage,
    synchronizer,
    new BrowserPresentationPreparer(storage),
    { load: getActivePresentation, commit: commitActivePresentation },
  );
}
