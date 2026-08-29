const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

global.window = { location: { href: 'https://player.test/play' } };

let BrowserMediaDownloadManager;
let BrowserVerifiedMediaSynchronizer;
let BrowserMediaAssetVerifier;
let BrowserPresentationActivationCoordinator;
let BrowserPresentationPreparer;

const modulesReady = Promise.all([
  import('../tsc-out/player-integration-test/media-sync/media-download-manager.js'),
  import('../tsc-out/player-integration-test/media-sync/verified-media-synchronizer.js'),
  import('../tsc-out/player-integration-test/media-verify/media-asset-verifier.js'),
  import('../tsc-out/player-integration-test/presentation/activation-coordinator.js'),
  import('../tsc-out/player-integration-test/presentation/presentation-preparer.js'),
]).then(([downloadModule, syncModule, verifierModule, coordinatorModule, preparerModule]) => {
  BrowserMediaDownloadManager = downloadModule.BrowserMediaDownloadManager;
  BrowserVerifiedMediaSynchronizer = syncModule.BrowserVerifiedMediaSynchronizer;
  BrowserMediaAssetVerifier = verifierModule.BrowserMediaAssetVerifier;
  BrowserPresentationActivationCoordinator = coordinatorModule.BrowserPresentationActivationCoordinator;
  BrowserPresentationPreparer = preparerModule.BrowserPresentationPreparer;
});

const MP4_BYTES = Uint8Array.from([
  0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70,
  0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0,
]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function storageKey(namespace, asset) {
  return `${namespace}/${asset.assetId}/${asset.binaryId}/${asset.binaryVersion}`;
}

function manifestAsset(id, bytes = MP4_BYTES) {
  const checksum = sha256(bytes);
  return {
    assetId: id,
    binaryId: `${id}:primary`,
    type: 'video',
    remoteUrl: `https://media.test/${id}.mp4`,
    binaryVersion: `sha256-${checksum}`,
    sha256: checksum,
    mimeType: 'video/mp4',
    fileSize: bytes.byteLength,
    priority: 'current',
    networkRequired: false,
  };
}

function playlistAsset(asset) {
  return {
    id: asset.assetId,
    name: asset.assetId,
    type: 'VIDEO',
    mimeType: 'video/mp4',
    url: asset.remoteUrl,
    thumbnailUrl: null,
    pageUrls: [],
    textContent: null,
    textFontFamily: null,
    textColor: null,
    textSize: null,
    textBackgroundColor: null,
    textTickerEnabled: false,
    textTickerDirection: 'LEFT_TO_RIGHT',
    textTickerSpeed: null,
    textTickerCrossOffset: null,
  };
}

function playerState(asset) {
  return {
    screenId: 'screen-1', streamingType: 'PLAYLIST', timezone: 'UTC', latitude: null,
    longitude: null, prayerMethod: 'MWL', athanEnabled: false, stopped: false,
    showClock: false, orientation: 0, aspectRatio: '16:9', emergencyActive: false,
    emergencyPlaylist: null, asset: null, wayfinding: null, scheduleRules: [],
    resolvedPlaylistId: null,
    defaultPlaylist: {
      id: `playlist-${asset.assetId}`,
      name: `Playlist ${asset.assetId}`,
      items: [{
        id: `item-${asset.assetId}`, position: 0, durationSecs: 10, muted: true,
        playFullVideo: true, cropZoom: null, cropOffsetX: null, cropOffsetY: null,
        kind: 'ASSET', asset: playlistAsset(asset), theme: null, layout: null, design: null,
      }],
    },
    poweredOn: true, powerScheduleRules: [], volume: 100,
  };
}

function manifest(revision, asset) {
  return {
    schemaVersion: 1,
    screenId: 'screen-1',
    contentRevision: revision,
    generatedAt: '2026-08-28T00:00:00.000Z',
    desiredState: playerState(asset),
    assets: [asset],
    networkDependencies: [],
    packagedFonts: [],
  };
}

function response(bytes, options = {}) {
  return new Response(bytes, {
    status: options.status ?? 200,
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(bytes.byteLength),
      ETag: options.etag ?? '"test-version"',
      ...(options.contentRange ? { 'Content-Range': options.contentRange } : {}),
    },
  });
}

class MemoryMediaStorage {
  namespace = 'screen-1';
  partials = new Map();
  verified = new Map();
  failures = [];
  leaseReferences = new Map();
  bytesWritten = 0;

  async initialize() { return this.getUsage(); }
  async exists(asset) { return this.verified.has(storageKey(this.namespace, asset)); }
  async getLocalUri(asset) {
    return this.verified.has(storageKey(this.namespace, asset)) ? this.uri(asset) : null;
  }
  async acquireLocalUri(asset) {
    const key = storageKey(this.namespace, asset);
    if (!this.verified.has(key)) return null;
    this.leaseReferences.set(key, (this.leaseReferences.get(key) ?? 0) + 1);
    let released = false;
    return {
      uri: this.uri(asset),
      release: () => {
        if (released) return;
        released = true;
        this.leaseReferences.set(key, Math.max(0, (this.leaseReferences.get(key) ?? 1) - 1));
      },
    };
  }
  async getPartial(asset) { return this.partials.get(storageKey(this.namespace, asset))?.record ?? null; }
  async listPartials() { return [...this.partials.values()].map(entry => entry.record); }
  async writePartial(asset, stream, options) {
    const key = storageKey(this.namespace, asset);
    const previous = this.partials.get(key);
    const chunks = previous && options.offset > 0
      ? [previous.bytes.subarray(0, options.offset)]
      : [];
    const reader = stream.getReader();
    let receivedBytes = options.offset;
    let thrown = null;
    try {
      while (true) {
        if (options.signal?.aborted) throw options.signal.reason;
        const result = await reader.read();
        if (result.done) break;
        chunks.push(result.value);
        receivedBytes += result.value.byteLength;
        this.bytesWritten += result.value.byteLength;
        options.onProgress?.(receivedBytes);
      }
    } catch (error) {
      thrown = error;
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
    let cursor = 0;
    for (const chunk of chunks) { bytes.set(chunk, cursor); cursor += chunk.byteLength; }
    const record = {
      storageKey: key, namespace: this.namespace, assetId: asset.assetId,
      binaryId: asset.binaryId, binaryVersion: asset.binaryVersion, sha256: asset.sha256,
      mimeType: asset.mimeType, expectedBytes: asset.fileSize, receivedBytes,
      physicalName: `${asset.binaryId}.part`, validator: options.validator,
      status: thrown ? 'FAILED' : receivedBytes === asset.fileSize ? 'DOWNLOADED' : 'DOWNLOADING',
      lastError: thrown instanceof Error ? thrown.message : null,
      createdAt: previous?.record.createdAt ?? 1, updatedAt: Date.now(),
    };
    this.partials.set(key, { record, bytes });
    if (thrown) throw thrown;
    return record;
  }
  async openPartialStream(asset) {
    const entry = this.partials.get(storageKey(this.namespace, asset));
    if (!entry) return null;
    return new ReadableStream({
      start(controller) { controller.enqueue(entry.bytes); controller.close(); },
    });
  }
  async acquirePartialUri(asset) {
    return this.partials.has(storageKey(this.namespace, asset))
      ? { uri: `blob:staged/${asset.binaryId}`, release() {} }
      : null;
  }
  async discardPartial(asset) { this.partials.delete(storageKey(this.namespace, asset)); }
  async commitVerifiedPartial(asset, evidence) {
    const key = storageKey(this.namespace, asset);
    const entry = this.partials.get(key);
    if (!entry) throw new Error(`Missing staged bytes for ${asset.binaryId}`);
    this.verified.set(key, { asset: { ...asset }, bytes: entry.bytes, evidence });
    this.partials.delete(key);
    return this.uri(asset);
  }
  async recordVerificationFailure(asset, stage, message) {
    const failure = {
      storageKey: storageKey(this.namespace, asset), namespace: this.namespace,
      assetId: asset.assetId, binaryId: asset.binaryId, binaryVersion: asset.binaryVersion,
      sha256: asset.sha256, mimeType: asset.mimeType, expectedBytes: asset.fileSize,
      stage, message, attempts: this.failures.length + 1, failedAt: Date.now(),
    };
    this.failures.push(failure);
    return failure;
  }
  async listVerificationFailures() { return [...this.failures]; }
  async remove(assetId) {
    for (const [key, entry] of this.verified) {
      if (entry.asset.assetId === assetId && (this.leaseReferences.get(key) ?? 0) === 0) this.verified.delete(key);
    }
  }
  async list() {
    return [...this.verified.entries()].map(([key, entry]) => ({
      storageKey: key, namespace: this.namespace, assetId: entry.asset.assetId,
      binaryId: entry.asset.binaryId, binaryVersion: entry.asset.binaryVersion,
      sha256: entry.asset.sha256, mimeType: entry.asset.mimeType, fileSize: entry.bytes.byteLength,
      priority: entry.asset.priority, physicalName: entry.asset.binaryId, backend: 'opfs',
      verificationStatus: 'VERIFIED', verifiedAt: entry.evidence.verifiedAt,
      storedAt: 1, lastUsedAt: 1,
    }));
  }
  async getUsage() {
    const mediaBytes = [...this.verified.values()].reduce((total, entry) => total + entry.bytes.byteLength, 0);
    return {
      backend: 'opfs', mediaBytes, originUsageBytes: mediaBytes, quotaBytes: 1_000_000,
      availableBytes: 1_000_000 - mediaBytes, persisted: true, persistenceSupported: true,
    };
  }
  async cleanup() {
    const remainingBytes = (await this.getUsage()).mediaBytes;
    return { removedStorageKeys: [], removedBytes: 0, remainingBytes };
  }
  async reconcile() {}
  async requestPersistence() { return true; }
  dispose() {}
  uri(asset) { return `blob:local/${asset.binaryId}/${asset.binaryVersion}`; }
}

class MemoryPresentationPersistence {
  records = new Map();
  async load(namespace) { return this.records.get(namespace); }
  async commit(record) { this.records.set(record.namespace, structuredClone(record)); }
}

function runtime(storage, persistence, fetchImpl) {
  const downloads = new BrowserMediaDownloadManager(storage, {
    fetch: fetchImpl,
    startupJitterMaxMs: 0,
    retryDelaysMs: [0],
    backgroundRetryDelayMs: 60_000,
    connectionTimeoutMs: 1_000,
    noProgressTimeoutMs: 1_000,
    baseAttemptTimeoutMs: 1_000,
    minimumThroughputBytesPerSecond: 1,
  });
  const verifier = new BrowserMediaAssetVerifier(storage, { readabilityProbe: async () => {} });
  const synchronizer = new BrowserVerifiedMediaSynchronizer(storage, downloads, verifier);
  const preparer = new BrowserPresentationPreparer(storage, async () => {});
  const coordinator = new BrowserPresentationActivationCoordinator(
    storage, synchronizer, preparer, persistence, () => 1234,
  );
  return { coordinator, downloads };
}

test('manifest fetch pipeline downloads once, verifies, activates locally, and restores offline without a transfer', async () => {
  await modulesReady;
  const asset = manifestAsset('video-a');
  const candidate = manifest('revision-a', asset);
  const storage = new MemoryMediaStorage();
  const persistence = new MemoryPresentationPersistence();
  const requests = [];
  const online = runtime(storage, persistence, async (url, init) => {
    requests.push({ url, cache: init.cache });
    return response(MP4_BYTES);
  });

  const activated = await online.coordinator.activate(candidate);

  assert.equal(activated.status, 'ACTIVE');
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /__lumina_media_sync=1/);
  assert.equal(requests[0].cache, 'no-store');
  assert.match(activated.presentation.state.defaultPlaylist.items[0].asset.url, /^blob:local\//);
  assert.equal(activated.presentation.state.defaultPlaylist.items[0].asset.url.includes('media.test'), false);
  assert.equal((await persistence.load('screen-1')).contentRevision, 'revision-a');
  assert.equal((await storage.list()).length, 1);

  activated.presentation.release();
  online.coordinator.dispose();

  let offlineRequests = 0;
  const restarted = runtime(storage, persistence, async () => {
    offlineRequests += 1;
    throw new Error('Network must not be touched during restore');
  });
  const restored = await restarted.coordinator.restore();
  const unchanged = await restarted.coordinator.activate(candidate);

  assert.equal(restored.status, 'ACTIVE');
  assert.equal(restored.restored, true);
  assert.match(restored.presentation.state.defaultPlaylist.items[0].asset.url, /^blob:local\//);
  assert.equal(unchanged.unchanged, true);
  assert.equal(offlineRequests, 0);
  restored.presentation.release();
  restarted.coordinator.dispose();
});

test('interrupted candidate remains inactive, resumes by Range, and activates only after verification', async () => {
  await modulesReady;
  const baselineAsset = manifestAsset('baseline');
  const nextAsset = manifestAsset('next');
  const baseline = manifest('baseline-revision', baselineAsset);
  const candidate = manifest('next-revision', nextAsset);
  const storage = new MemoryMediaStorage();
  const persistence = new MemoryPresentationPersistence();
  let nextRequests = 0;
  let resumeRange = null;

  const activeRuntime = runtime(storage, persistence, async (url, init) => {
    if (url.includes('baseline.mp4')) return response(MP4_BYTES, { etag: '"baseline"' });
    nextRequests += 1;
    if (nextRequests === 1) {
      let pull = 0;
      return new Response(new ReadableStream({
        pull(controller) {
          if (pull++ === 0) controller.enqueue(MP4_BYTES.subarray(0, 8));
          else controller.error(new Error('simulated disconnect'));
        },
      }), {
        headers: {
          'Content-Type': 'video/mp4', 'Content-Length': String(MP4_BYTES.byteLength), ETag: '"next"',
        },
      });
    }
    resumeRange = new Headers(init.headers).get('range');
    return response(MP4_BYTES.subarray(8), {
      status: 206, etag: '"next"', contentRange: 'bytes 8-15/16',
    });
  });

  const active = await activeRuntime.coordinator.activate(baseline);
  const interrupted = await activeRuntime.coordinator.activate(candidate);

  assert.equal(active.status, 'ACTIVE');
  assert.equal(interrupted.status, 'FAILED');
  assert.equal((await persistence.load('screen-1')).contentRevision, 'baseline-revision');
  assert.match(active.presentation.state.defaultPlaylist.items[0].asset.url, /baseline/);

  const resumed = await activeRuntime.coordinator.activate(candidate);

  assert.equal(resumed.status, 'ACTIVE');
  assert.equal(resumeRange, 'bytes=8-');
  assert.equal(nextRequests, 2);
  assert.equal((await persistence.load('screen-1')).contentRevision, 'next-revision');
  assert.match(resumed.presentation.state.defaultPlaylist.items[0].asset.url, /next/);
  active.presentation.release();
  resumed.presentation.release();
  activeRuntime.coordinator.dispose();
});
