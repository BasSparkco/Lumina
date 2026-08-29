const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

const { IncrementalSha256 } = require('../tsc-out/media-verify-test/media-verify/incremental-sha256.js');
const { BrowserMediaAssetVerifier } = require('../tsc-out/media-verify-test/media-verify/media-asset-verifier.js');
const {
  BrowserVerifiedMediaSynchronizer,
} = require('../tsc-out/media-verify-test/media-sync/verified-media-synchronizer.js');

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function videoAsset(bytes, overrides = {}) {
  return {
    namespace: 'screen-1',
    assetId: 'asset-1',
    binaryId: 'asset-1:primary',
    binaryVersion: `sha256-${sha256(bytes)}`,
    sha256: sha256(bytes),
    mimeType: 'video/mp4',
    fileSize: bytes.byteLength,
    type: 'video',
    priority: 'current',
    remoteUrl: 'https://media.test/asset-1.mp4',
    networkRequired: false,
    ...overrides,
  };
}

function storageKey(asset) {
  return `${asset.namespace}/${asset.assetId}/${asset.binaryId}/${asset.binaryVersion}`;
}

class VerificationStorage {
  namespace = 'screen-1';
  discarded = false;
  committed = null;
  failures = [];
  released = false;
  available = false;

  constructor(bytes, asset) {
    this.bytes = bytes;
    this.asset = asset;
  }

  async exists() { return this.available; }
  async getLocalUri() { return this.available ? 'blob:verified' : null; }
  async getPartial() {
    if (this.discarded || this.available) return null;
    return {
      storageKey: storageKey(this.asset), namespace: this.namespace,
      assetId: this.asset.assetId, binaryId: this.asset.binaryId,
      binaryVersion: this.asset.binaryVersion, sha256: this.asset.sha256,
      mimeType: this.asset.mimeType, expectedBytes: this.asset.fileSize,
      receivedBytes: this.bytes.byteLength, physicalName: 'candidate.part',
      validator: 'etag:test', status: 'DOWNLOADED', lastError: null,
      createdAt: 1, updatedAt: 1,
    };
  }
  async openPartialStream() {
    const midpoint = Math.floor(this.bytes.byteLength / 2);
    const chunks = [this.bytes.subarray(0, midpoint), this.bytes.subarray(midpoint)];
    return new ReadableStream({
      pull(controller) {
        const chunk = chunks.shift();
        if (chunk) controller.enqueue(chunk);
        else controller.close();
      },
    });
  }
  async acquirePartialUri() {
    return { uri: 'blob:staged', release: () => { this.released = true; } };
  }
  async commitVerifiedPartial(_asset, evidence) {
    this.committed = evidence;
    this.available = true;
    return 'blob:verified';
  }
  async discardPartial() { this.discarded = true; }
  async recordVerificationFailure(asset, stage, message) {
    const failure = {
      storageKey: storageKey(asset), namespace: this.namespace, assetId: asset.assetId,
      binaryId: asset.binaryId, binaryVersion: asset.binaryVersion, sha256: asset.sha256,
      mimeType: asset.mimeType, expectedBytes: asset.fileSize, stage, message,
      attempts: this.failures.length + 1, failedAt: Date.now(),
    };
    this.failures.push(failure);
    return failure;
  }
}

test('incremental SHA-256 matches standard vectors across chunk boundaries', () => {
  const empty = new IncrementalSha256().digestHex();
  assert.equal(empty, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');

  const hash = new IncrementalSha256();
  hash.update(Buffer.from('The quick '));
  hash.update(Buffer.from('brown fox jumps over the lazy dog'));
  assert.equal(hash.digestHex(), 'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592');

  const million = new IncrementalSha256();
  million.update(Buffer.alloc(1_000_000, 0x61));
  assert.equal(million.digestHex(), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
});

test('promotes a size, checksum, MIME, and decoder-verified staged video', async () => {
  const bytes = Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
  const asset = videoAsset(bytes);
  const storage = new VerificationStorage(bytes, asset);
  let probes = 0;
  const verifier = new BrowserMediaAssetVerifier(storage, {
    readabilityProbe: async (_candidate, uri) => { probes += 1; assert.equal(uri, 'blob:staged'); },
    now: () => 1234,
  });

  const result = await verifier.verify(asset);

  assert.equal(result.status, 'VERIFIED');
  assert.equal(storage.committed.sha256, asset.sha256);
  assert.equal(storage.committed.verifiedAt, 1234);
  assert.equal(storage.committed.readable, true);
  assert.equal(storage.released, true);
  assert.equal(probes, 1);
});

test('deletes and persists FAILED when checksum verification rejects a staged file', async () => {
  const bytes = Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 1, 2, 3, 4]);
  const asset = videoAsset(bytes, { sha256: '0'.repeat(64) });
  const storage = new VerificationStorage(bytes, asset);
  const verifier = new BrowserMediaAssetVerifier(storage, { readabilityProbe: async () => {} });

  const result = await verifier.verify(asset);

  assert.equal(result.status, 'FAILED');
  assert.equal(result.stage, 'CHECKSUM');
  assert.equal(storage.discarded, true);
  assert.equal(storage.committed, null);
  assert.equal(storage.failures[0].stage, 'CHECKSUM');
});

test('rejects matching-checksum bytes whose signature does not match the manifest MIME', async () => {
  const bytes = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const asset = videoAsset(bytes);
  const storage = new VerificationStorage(bytes, asset);
  const verifier = new BrowserMediaAssetVerifier(storage, { readabilityProbe: async () => {} });

  const result = await verifier.verify(asset);

  assert.equal(result.status, 'FAILED');
  assert.equal(result.stage, 'MIME');
  assert.equal(storage.failures[0].stage, 'MIME');
});

test('decoder rejection prevents promotion and becomes a READABILITY failure', async () => {
  const bytes = Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
  const asset = videoAsset(bytes);
  const storage = new VerificationStorage(bytes, asset);
  const verifier = new BrowserMediaAssetVerifier(storage, {
    readabilityProbe: async () => { throw new Error('unsupported codec'); },
  });

  const result = await verifier.verify(asset);

  assert.equal(result.status, 'FAILED');
  assert.equal(result.stage, 'READABILITY');
  assert.equal(storage.released, true);
  assert.equal(storage.committed, null);
});

test('verified synchronizer reports ready only when every manifest asset is verified', async () => {
  const first = videoAsset(Uint8Array.of(1), { assetId: 'first', binaryId: 'first:primary' });
  const second = videoAsset(Uint8Array.of(2), { assetId: 'second', binaryId: 'second:primary' });
  const downloads = {
    async synchronize(manifest) {
      return {
        assets: manifest.map(asset => ({ ...asset, status: 'DOWNLOADED', receivedBytes: 1, error: null })),
        available: 0, downloaded: manifest.length, failed: 0, cancelled: 0,
        allDownloaded: true, ready: false,
      };
    },
    async cancel() {}, getProgress() { return []; }, subscribe() { return () => {}; }, dispose() {},
  };
  const verifier = {
    async verify(asset) {
      return {
        assetId: asset.assetId, binaryId: asset.binaryId, binaryVersion: asset.binaryVersion,
        status: asset.assetId === 'first' ? 'VERIFIED' : 'FAILED', fileSize: asset.fileSize,
        sha256: asset.sha256, localUri: null,
        stage: asset.assetId === 'first' ? null : 'READABILITY',
        error: asset.assetId === 'first' ? null : 'decoder rejected',
      };
    },
  };
  const sync = new BrowserVerifiedMediaSynchronizer({ namespace: 'screen-1' }, downloads, verifier);

  const result = await sync.synchronize([first, second]);

  assert.equal(result.ready, false);
  assert.equal(result.verified, 1);
  assert.equal(result.failed, 1);
});
