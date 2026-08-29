import type { PlayerState } from '../api';

export type PresentationStatus = 'ACTIVE' | 'DOWNLOADING' | 'READY' | 'FAILED' | 'SUPERSEDED';

export interface PreparedPlayerPresentation {
  contentRevision: string;
  state: PlayerState;
  assetStorageKeys: string[];
  release(): void;
}

export type PresentationActivationResult =
  | {
    status: 'ACTIVE';
    presentation: PreparedPlayerPresentation | null;
    restored: boolean;
    unchanged: boolean;
  }
  | { status: 'FAILED' | 'SUPERSEDED'; presentation: null; restored: false; error: string };
