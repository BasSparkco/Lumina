import type { PlayerAssetManifestItem, PlayerContentManifest } from '@lumina/types';
import type { PlayerState } from '../api';
import { mediaStorageKey } from '../media-storage/identity.js';
import type { LocalMediaLease, MediaAssetDescriptor, MediaStorage } from '../media-storage/types';
import { probeMediaReadability } from '../media-verify/readability-probe.js';
import { rewritePlayerStateToLocalUris } from './rewrite-player-state.js';
import type { PreparedPlayerPresentation } from './types';

type CandidateManifest = Pick<PlayerContentManifest<PlayerState>, 'contentRevision' | 'desiredState' | 'assets'>;
type ActivationReadinessProbe = (asset: MediaAssetDescriptor, uri: string) => Promise<void>;

function documentPageNumber(asset: PlayerAssetManifestItem): number {
  const prefix = `${asset.assetId}:page:`;
  const page = asset.binaryId.startsWith(prefix) ? Number(asset.binaryId.slice(prefix.length)) : NaN;
  if (!Number.isSafeInteger(page) || page <= 0) {
    throw new Error(`Invalid document-page identity ${asset.binaryId}`);
  }
  return page;
}

export class BrowserPresentationPreparer {
  constructor(
    private readonly storage: MediaStorage,
    private readonly readinessProbe: ActivationReadinessProbe = probeMediaReadability,
  ) {}

  async prepare(manifest: CandidateManifest): Promise<PreparedPlayerPresentation> {
    const leases: LocalMediaLease[] = [];
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      for (const lease of leases) lease.release();
    };

    try {
      const primary = new Map<string, string>();
      const pages = new Map<string, Map<number, string>>();
      const leasedAssets: { asset: MediaAssetDescriptor; uri: string }[] = [];
      const assetStorageKeys: string[] = [];
      const seenKeys = new Set<string>();

      for (const item of manifest.assets) {
        const asset: MediaAssetDescriptor = { ...item, namespace: this.storage.namespace };
        const key = mediaStorageKey(this.storage.namespace, item);
        if (seenKeys.has(key)) throw new Error(`Candidate contains duplicate media binary ${item.binaryId}`);
        seenKeys.add(key);
        const lease = await this.storage.acquireLocalUri(asset);
        if (!lease) throw new Error(`Verified local media is unavailable for ${item.binaryId}`);
        leases.push(lease);
        // Browser playback must never silently fall back to the manifest's remote URL. OPFS
        // leases are exposed as blob URLs; rejecting anything else makes the offline contract an
        // activation invariant instead of relying on every renderer to remember it independently.
        if (!lease.uri.startsWith('blob:')) {
          throw new Error(`Local media lease is not browser-local for ${item.binaryId}`);
        }
        leasedAssets.push({ asset, uri: lease.uri });
        assetStorageKeys.push(key);

        if (item.type === 'document-page') {
          const page = documentPageNumber(item);
          const assetPages = pages.get(item.assetId) ?? new Map<number, string>();
          if (assetPages.has(page)) throw new Error(`Duplicate document page ${item.binaryId}`);
          assetPages.set(page, lease.uri);
          pages.set(item.assetId, assetPages);
        } else {
          if (primary.has(item.assetId)) throw new Error(`Duplicate primary binary for ${item.assetId}`);
          primary.set(item.assetId, lease.uri);
        }
      }

      // Activation repeats video decoder readiness against the final leased URI. Integrity says
      // bytes are correct; this device-level probe says the candidate can actually be played.
      for (const local of leasedAssets) {
        if (local.asset.type === 'video') await this.readinessProbe(local.asset, local.uri);
      }

      const orderedPages = new Map<string, readonly string[]>();
      for (const [assetId, assetPages] of pages) {
        const entries = [...assetPages.entries()].sort(([a], [b]) => a - b);
        entries.forEach(([page], index) => {
          if (page !== index + 1) throw new Error(`Document ${assetId} is missing page ${index + 1}`);
        });
        orderedPages.set(assetId, entries.map(([, uri]) => uri));
      }

      const state = rewritePlayerStateToLocalUris(
        manifest.desiredState,
        { primary, pages: orderedPages },
        new Set(manifest.assets.map(asset => asset.remoteUrl)),
      );
      return { contentRevision: manifest.contentRevision, state, assetStorageKeys, release };
    } catch (error) {
      release();
      throw error;
    }
  }
}
