const test = require('node:test');
const assert = require('node:assert/strict');

global.window = { location: { href: 'https://player.test/play' } };

const {
  BrowserMediaDownloadManager,
  sortManifestForDownload,
} = require('../tsc-out/media-sync-test/media-sync/media-download-manager.js');

const SHA = 'a'.repeat(64);

function asset(id, priority = 'scheduled', overrides = {}) {
  return {
    assetId: id,
    binaryId: `${id}:primary`,
    type: 'video',
    remoteUrl: `https://media.test/${id}.mp4`,
    binaryVersion: `sha256-${SHA}`,
    sha256: SHA,
    mimeType: 'video/mp4',
    fileSize: 4,
    priority,
    networkRequired: false,
    ...overrides,
  };
}

function key(namespace, item) {
  return `${namespace}/${item.assetId}/${item.binaryId}/${item.binaryVersion}`;
}

class FakeStorage {
  namespace = 'screen-1';
  assets = new Set();
  partials = new Map();
  discarded = [];

  async initialize() { throw new Error('unused'); }
  async exists(item) { return this.assets.has(key(this.namespace, item)); }
  async getLocalUri() { return null; }
  async acquireLocalUri() { return null; }
  async save() { throw new Error('unused'); }
  async getPartial(item) { return this.partials.get(key(this.namespace, item)) ?? null; }
  async listPartials() { return [...this.partials.values()]; }
  async discardPartial(item) {
    this.discarded.push(item.binaryId);
    this.partials.delete(key(this.namespace, item));
  }
  async writePartial(item, stream, options) {
    const reader = stream.getReader();
    let receivedBytes = options.offset;
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      receivedBytes += result.value.byteLength;
      options.onProgress?.(receivedBytes);
    }
    const previous = this.partials.get(key(this.namespace, item));
    const partial = {
      storageKey: key(this.namespace, item),
      namespace: this.namespace,
      assetId: item.assetId,
      binaryId: item.binaryId,
      binaryVersion: item.binaryVersion,
      sha256: item.sha256,
      mimeType: item.mimeType,
      expectedBytes: item.fileSize,
      receivedBytes,
      physicalName: `${item.binaryId}.part`,
      validator: options.validator,
      status: receivedBytes === item.fileSize ? 'DOWNLOADED' : 'DOWNLOADING',
      lastError: null,
      createdAt: previous?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    };
    this.partials.set(partial.storageKey, partial);
    return partial;
  }
  async openPartialStream() { return null; }
  async commitVerifiedPartial() { throw new Error('Phase 5 only'); }
  async remove() {}
  async list() { return []; }
  async getUsage() { throw new Error('unused'); }
  async cleanup() { throw new Error('unused'); }
  async reconcile() {}
  async requestPersistence() { return true; }
  dispose() {}
}

function response(bytes, options = {}) {
  const headers = new Headers({
    'Content-Type': 'video/mp4',
    'Content-Length': String(bytes.length),
    ETag: options.etag ?? '"version-a"',
    ...(options.contentRange ? { 'Content-Range': options.contentRange } : {}),
  });
  return new Response(Uint8Array.from(bytes), { status: options.status ?? 200, headers });
}

function manager(storage, fetchImpl, overrides = {}) {
  return new BrowserMediaDownloadManager(storage, {
    fetch: fetchImpl,
    startupJitterMaxMs: 0,
    retryDelaysMs: [0],
    backgroundRetryDelayMs: 60_000,
    ...overrides,
  });
}

test('sorts current then next while preserving manifest order inside a priority', () => {
  const ordered = sortManifestForDownload([
    asset('later-a'), asset('next', 'next'), asset('current', 'current'), asset('later-b'),
  ]);
  assert.deepEqual(ordered.map(item => item.assetId), ['current', 'next', 'later-a', 'later-b']);
});

test('enforces one large transfer and joins concurrent callers for one binary version', async () => {
  const storage = new FakeStorage();
  let active = 0;
  let maximumActive = 0;
  let requests = 0;
  const fetchImpl = async () => {
    requests += 1;
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    let sent = false;
    return new Response(new ReadableStream({
      async pull(controller) {
        if (sent) {
          active -= 1;
          controller.close();
          return;
        }
        sent = true;
        await new Promise(resolve => setTimeout(resolve, 5));
        controller.enqueue(Uint8Array.from([1, 2, 3, 4]));
      },
    }), { headers: { 'Content-Type': 'video/mp4', 'Content-Length': '4', ETag: '"version-a"' } });
  };
  const downloader = manager(storage, fetchImpl);
  const current = asset('current', 'current');

  const [first, joined] = await Promise.all([
    downloader.synchronize([current, asset('next', 'next')]),
    downloader.synchronize([current, asset('next', 'next')]),
  ]);

  assert.equal(first.allDownloaded, true);
  assert.equal(joined.allDownloaded, true);
  assert.equal(maximumActive, 1);
  assert.equal(requests, 2, 'two unique binaries should each transfer once');
  downloader.dispose();
});

test('resumes only from a matching validator and exact Content-Range', async () => {
  const storage = new FakeStorage();
  const item = asset('resume');
  storage.partials.set(key(storage.namespace, item), {
    storageKey: key(storage.namespace, item), namespace: storage.namespace,
    assetId: item.assetId, binaryId: item.binaryId, binaryVersion: item.binaryVersion,
    sha256: item.sha256, mimeType: item.mimeType, expectedBytes: 4, receivedBytes: 2,
    physicalName: 'resume.part', validator: 'etag:"version-a"', status: 'FAILED',
    lastError: 'interrupted', createdAt: Date.now(), updatedAt: Date.now(),
  });
  let rangeHeader;
  const downloader = manager(storage, async (_url, init) => {
    rangeHeader = new Headers(init.headers).get('range');
    return response([3, 4], { status: 206, contentRange: 'bytes 2-3/4' });
  });

  const result = await downloader.synchronize([item]);

  assert.equal(rangeHeader, 'bytes=2-');
  assert.equal(result.downloaded, 1);
  assert.equal(result.ready, false);
  assert.equal((await storage.getPartial({ ...item, namespace: storage.namespace })).receivedBytes, 4);
  downloader.dispose();
});

test('discards a changed validator before restarting from byte zero', async () => {
  const storage = new FakeStorage();
  const item = asset('changed');
  storage.partials.set(key(storage.namespace, item), {
    storageKey: key(storage.namespace, item), namespace: storage.namespace,
    assetId: item.assetId, binaryId: item.binaryId, binaryVersion: item.binaryVersion,
    sha256: item.sha256, mimeType: item.mimeType, expectedBytes: 4, receivedBytes: 2,
    physicalName: 'changed.part', validator: 'etag:"version-a"', status: 'FAILED',
    lastError: 'interrupted', createdAt: Date.now(), updatedAt: Date.now(),
  });
  let requests = 0;
  const downloader = manager(storage, async () => {
    requests += 1;
    if (requests === 1) {
      return response([3, 4], { status: 206, contentRange: 'bytes 2-3/4', etag: '"version-b"' });
    }
    return response([1, 2, 3, 4], { etag: '"version-b"' });
  }, { retryDelaysMs: [0, 0] });

  const result = await downloader.synchronize([item]);

  assert.equal(requests, 2);
  assert.deepEqual(storage.discarded, [item.binaryId]);
  assert.equal(result.downloaded, 1);
  downloader.dispose();
});

test('a newer manifest cancels an older preflight before it can start a transfer', async () => {
  const storage = new FakeStorage();
  const old = asset('old-candidate');
  const next = asset('new-candidate');
  storage.exists = async item => {
    if (item.assetId === old.assetId) await new Promise(resolve => setTimeout(resolve, 10));
    return false;
  };
  const requested = [];
  const downloader = manager(storage, async url => {
    requested.push(url);
    return response([1, 2, 3, 4]);
  });

  const oldSync = downloader.synchronize([old]);
  await new Promise(resolve => setTimeout(resolve, 1));
  const newSync = downloader.synchronize([next]);
  const [oldResult, newResult] = await Promise.all([oldSync, newSync]);

  assert.equal(oldResult.cancelled, 1);
  assert.equal(newResult.downloaded, 1);
  assert.equal(requested.length, 1);
  assert.match(requested[0], /new-candidate/);
  downloader.dispose();
});
