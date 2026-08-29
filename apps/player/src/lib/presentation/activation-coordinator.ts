import type { PlayerContentManifest } from '@lumina/types';
import type { PlayerState } from '../api';
import type { MediaStorage, StoredActivePresentation } from '../media-storage/types';
import type { VerifiedMediaSynchronizer } from '../media-sync/types';
import type { BrowserPresentationPreparer } from './presentation-preparer.js';
import type {
  PresentationActivationResult,
  PresentationStatus,
} from './types';

export interface PresentationPersistence {
  load(namespace: string): Promise<StoredActivePresentation | undefined>;
  commit(presentation: StoredActivePresentation): Promise<void>;
}

/** Keeps the active presentation untouched until a complete candidate is durable and local. */
export class BrowserPresentationActivationCoordinator {
  private generation = 0;
  private currentRevision: string | null = null;
  private status: PresentationStatus = 'DOWNLOADING';
  private disposed = false;

  constructor(
    private readonly storage: MediaStorage,
    private readonly synchronizer: VerifiedMediaSynchronizer,
    private readonly preparer: BrowserPresentationPreparer,
    private readonly persistence: PresentationPersistence,
    private readonly now: () => number = Date.now,
  ) {}

  getStatus(): PresentationStatus {
    return this.status;
  }

  async restore(): Promise<PresentationActivationResult> {
    if (this.disposed) return this.failure('FAILED', 'Presentation coordinator is disposed');
    try {
      const stored = await this.persistence.load(this.storage.namespace);
      if (!stored) return this.failure('FAILED', 'No active presentation is stored');
      const presentation = await this.preparer.prepare({
        contentRevision: stored.contentRevision,
        desiredState: stored.sourceState as PlayerState,
        assets: stored.assets,
      });
      if (presentation.assetStorageKeys.length !== stored.assetStorageKeys.length
        || presentation.assetStorageKeys.some((key, index) => key !== stored.assetStorageKeys[index])) {
        presentation.release();
        throw new Error('Stored active presentation media keys do not match its snapshot');
      }
      this.currentRevision = stored.contentRevision;
      this.status = 'ACTIVE';
      this.log('presentation-restored', { contentRevision: stored.contentRevision });
      return { status: 'ACTIVE', presentation, restored: true, unchanged: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.status = 'FAILED';
      this.log('presentation-restore-failed', { error: message });
      return this.failure('FAILED', message);
    }
  }

  async activate(manifest: PlayerContentManifest<PlayerState>): Promise<PresentationActivationResult> {
    if (this.disposed) return this.failure('FAILED', 'Presentation coordinator is disposed');
    if (manifest.contentRevision === this.currentRevision) {
      this.status = 'ACTIVE';
      return { status: 'ACTIVE', presentation: null, restored: false, unchanged: true };
    }
    const generation = ++this.generation;
    this.status = 'DOWNLOADING';
    this.log('candidate-started', { contentRevision: manifest.contentRevision, generation });

    let synchronization;
    try {
      synchronization = await this.synchronizer.synchronize(manifest.assets);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.status = 'FAILED';
      this.log('candidate-failed', { contentRevision: manifest.contentRevision, error: message });
      return this.failure('FAILED', message);
    }
    if (generation !== this.generation || this.disposed) return this.superseded(manifest.contentRevision);
    if (!synchronization.ready) {
      const message = `Candidate has ${synchronization.failed} failed and ${synchronization.cancelled} cancelled assets`;
      this.status = 'FAILED';
      this.log('candidate-failed', { contentRevision: manifest.contentRevision, error: message });
      return this.failure('FAILED', message);
    }

    let presentation;
    try {
      presentation = await this.preparer.prepare(manifest);
      if (generation !== this.generation || this.disposed) {
        presentation.release();
        return this.superseded(manifest.contentRevision);
      }
      this.status = 'READY';
      await this.persistence.commit({
        namespace: this.storage.namespace,
        contentRevision: manifest.contentRevision,
        sourceState: manifest.desiredState,
        assets: [...manifest.assets],
        assetStorageKeys: [...presentation.assetStorageKeys],
        activatedAt: this.now(),
      });
      if (generation !== this.generation || this.disposed) {
        presentation.release();
        return this.superseded(manifest.contentRevision);
      }
    } catch (error) {
      presentation?.release();
      const message = error instanceof Error ? error.message : String(error);
      this.status = 'FAILED';
      this.log('candidate-failed', { contentRevision: manifest.contentRevision, error: message });
      return this.failure('FAILED', message);
    }

    this.currentRevision = manifest.contentRevision;
    this.status = 'ACTIVE';
    this.log('candidate-activated', {
      contentRevision: manifest.contentRevision,
      assets: presentation.assetStorageKeys.length,
    });
    return { status: 'ACTIVE', presentation, restored: false, unchanged: false };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    this.synchronizer.dispose();
  }

  private superseded(contentRevision: string): PresentationActivationResult {
    this.log('candidate-superseded', { contentRevision });
    return this.failure('SUPERSEDED', 'Candidate was superseded by a newer manifest');
  }

  private failure(
    status: 'FAILED' | 'SUPERSEDED',
    error: string,
  ): PresentationActivationResult {
    return { status, presentation: null, restored: false, error };
  }

  private log(event: string, details: Record<string, unknown>) {
    console.info('[presentation-activation]', JSON.stringify({ event, ...details }));
  }
}
