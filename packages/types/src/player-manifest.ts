export type PlayerManifestPriority = 'current' | 'next' | 'scheduled' | 'fallback';
export type PlayerManifestAssetType = 'video' | 'image' | 'audio' | 'document-page' | 'other';

export interface PlayerAssetManifestItem {
  // Logical uploaded asset plus the particular persisted binary/rendition.
  assetId: string;
  binaryId: string;
  type: PlayerManifestAssetType;
  remoteUrl: string;
  binaryVersion: string;
  sha256: string;
  mimeType: string;
  fileSize: number;
  priority: PlayerManifestPriority;
  networkRequired: false;
}

export interface PlayerNetworkDependency {
  assetId: string;
  type: 'application';
  providerId: string | null;
  remoteUrl: string | null;
  priority: PlayerManifestPriority;
  networkRequired: true;
}

export interface PlayerContentManifest<TDesiredState = unknown> {
  schemaVersion: 1;
  screenId: string;
  contentRevision: string;
  generatedAt: string;
  desiredState: TDesiredState;
  assets: PlayerAssetManifestItem[];
  networkDependencies: PlayerNetworkDependency[];
  // These fonts ship in the versioned PWA app shell and are covered by the Workbox precache
  // revision rather than downloaded by the media download manager.
  packagedFonts: string[];
}
