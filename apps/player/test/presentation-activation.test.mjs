import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BrowserPresentationPreparer,
} from '../tsc-out/presentation-test/presentation/presentation-preparer.js';
import {
  BrowserPresentationActivationCoordinator,
} from '../tsc-out/presentation-test/presentation/activation-coordinator.js';
import {
  rewritePlayerStateToLocalUris,
} from '../tsc-out/presentation-test/presentation/rewrite-player-state.js';

const SHA = 'a'.repeat(64);

function manifestAsset(assetId, type, remoteUrl, overrides = {}) {
  return {
    assetId,
    binaryId: `${assetId}:primary`,
    type,
    remoteUrl,
    binaryVersion: `sha256-${SHA}`,
    sha256: SHA,
    mimeType: type === 'video' ? 'video/mp4' : 'image/webp',
    fileSize: 10,
    priority: 'current',
    networkRequired: false,
    ...overrides,
  };
}

function playlistAsset(id, type, url, pageUrls = []) {
  return {
    id, name: id, type, mimeType: type === 'VIDEO' ? 'video/mp4' : 'image/webp',
    url, thumbnailUrl: `${url}.thumb`, pageUrls,
    textContent: null, textFontFamily: null, textColor: null, textSize: null,
    textBackgroundColor: null, textTickerEnabled: false,
    textTickerDirection: 'LEFT_TO_RIGHT', textTickerSpeed: null, textTickerCrossOffset: null,
  };
}

function item(id, asset) {
  return {
    id: `item-${id}`, position: 0, durationSecs: 10, muted: true, playFullVideo: false,
    cropZoom: null, cropOffsetX: null, cropOffsetY: null,
    kind: 'ASSET', asset, theme: null, layout: null, design: null,
  };
}

function state(items) {
  return {
    screenId: 'screen-1', streamingType: 'PLAYLIST', timezone: 'UTC', latitude: null,
    longitude: null, prayerMethod: 'MWL', athanEnabled: false, stopped: false,
    showClock: false, orientation: 0, aspectRatio: '16:9', emergencyActive: false,
    emergencyPlaylist: null, asset: null, wayfinding: null, scheduleRules: [],
    resolvedPlaylistId: null, defaultPlaylist: { id: 'playlist', name: 'Playlist', items },
    poweredOn: true, powerScheduleRules: [], volume: 100,
  };
}

function key(namespace, asset) {
  return `${namespace}/${asset.assetId}/${asset.binaryId}/${asset.binaryVersion}`;
}

class LeaseStorage {
  namespace = 'screen-1';
  released = [];
  missing = new Set();

  async acquireLocalUri(asset) {
    if (this.missing.has(asset.binaryId)) return null;
    return {
      uri: `blob:local/${asset.binaryId}`,
      release: () => this.released.push(asset.binaryId),
    };
  }
}

test('prepares a complete local candidate and orders document pages without remote media URLs', async () => {
  const image = manifestAsset('image', 'image', 'https://media.test/image.webp');
  const video = manifestAsset('video', 'video', 'https://media.test/video.mp4');
  const page1 = manifestAsset('document', 'document-page', 'https://media.test/page-1.webp', {
    binaryId: 'document:page:1', priority: 'next',
  });
  const page2 = manifestAsset('document', 'document-page', 'https://media.test/page-2.webp', {
    binaryId: 'document:page:2', priority: 'next',
  });
  const source = state([
    item('image', playlistAsset('image', 'IMAGE', image.remoteUrl)),
    item('video', playlistAsset('video', 'VIDEO', video.remoteUrl)),
    item('document', playlistAsset('document', 'DOCUMENT', null, [page1.remoteUrl, page2.remoteUrl])),
  ]);
  const storage = new LeaseStorage();
  const probes = [];
  const preparer = new BrowserPresentationPreparer(storage, async (asset, uri) => probes.push([asset.type, uri]));

  const prepared = await preparer.prepare({
    contentRevision: 'revision-a', desiredState: source, assets: [image, video, page2, page1],
  });

  const assets = prepared.state.defaultPlaylist.items.map(entry => entry.asset);
  assert.equal(assets[0].url, 'blob:local/image:primary');
  assert.equal(assets[0].thumbnailUrl, null);
  assert.equal(assets[1].url, 'blob:local/video:primary');
  assert.deepEqual(assets[2].pageUrls, [
    'blob:local/document:page:1', 'blob:local/document:page:2',
  ]);
  assert.deepEqual(probes, [['video', 'blob:local/video:primary']]);
  assert.deepEqual(prepared.assetStorageKeys, [image, video, page2, page1].map(asset => key('screen-1', asset)));

  prepared.release();
  prepared.release();
  assert.deepEqual(storage.released.sort(), [
    'document:page:1', 'document:page:2', 'image:primary', 'video:primary',
  ]);
});

test('candidate preparation releases acquired leases when one required binary is unavailable', async () => {
  const first = manifestAsset('first', 'image', 'https://media.test/first.webp');
  const missing = manifestAsset('missing', 'video', 'https://media.test/missing.mp4');
  const storage = new LeaseStorage();
  storage.missing.add(missing.binaryId);
  const preparer = new BrowserPresentationPreparer(storage, async () => {});

  await assert.rejects(
    preparer.prepare({ contentRevision: 'revision-a', desiredState: state([]), assets: [first, missing] }),
    /unavailable/,
  );
  assert.deepEqual(storage.released, ['first:primary']);
});

test('candidate activation rejects a non-local media lease instead of falling back to a network URL', async () => {
  const image = manifestAsset('image', 'image', 'https://media.test/image.webp');
  const storage = new LeaseStorage();
  storage.acquireLocalUri = async asset => ({
    uri: `https://media.test/leaked/${asset.binaryId}`,
    release: () => storage.released.push(asset.binaryId),
  });
  const preparer = new BrowserPresentationPreparer(storage, async () => {});

  await assert.rejects(
    preparer.prepare({ contentRevision: 'revision-a', desiredState: state([]), assets: [image] }),
    /not browser-local/,
  );
  assert.deepEqual(storage.released, ['image:primary']);
});

test('rewrites nested themes, layouts, designs, and wayfinding references to local URIs', () => {
  const imageRemote = 'https://media.test/image.webp';
  const videoRemote = 'https://media.test/video.mp4';
  const pageRemote = 'https://media.test/page.webp';
  const nested = { id: 'nested', name: 'Nested', items: [item('image', playlistAsset('image', 'IMAGE', imageRemote))] };
  const theme = {
    id: 'theme', name: 'Theme', category: 'test', aspectRatio: '16:9', palette: {}, typography: {},
    elements: [
      { id: 'theme-image', kind: 'IMAGE', content: { assetId: 'image', url: imageRemote } },
      { id: 'theme-video', kind: 'VIDEO', content: { assetId: 'video', url: videoRemote } },
      { id: 'theme-doc', kind: 'DOCUMENT', content: { assetId: 'document', pageUrls: [pageRemote], secondsPerPage: 5 } },
      { id: 'theme-list', kind: 'PLAYLIST', content: { playlistId: 'nested', playlist: nested } },
    ],
  };
  const layoutItem = {
    ...item('layout', null), kind: 'LAYOUT',
    layout: { id: 'layout', name: 'Layout', zones: [{ id: 'zone', playlist: nested }] },
  };
  const designItem = {
    ...item('design', null), kind: 'DESIGN',
    design: {
      schemaVersion: 1, id: 'design', canvas: { width: 1920, height: 1080, backgroundColor: '#000' },
      scenes: [{
        id: 'scene', durationMs: 1000,
        background: { type: 'image', assetId: 'image', resolvedSrc: imageRemote },
        elements: [
          { id: 'design-image', type: 'image', assetId: 'image', resolvedSrc: imageRemote },
          {
            id: 'design-video', type: 'video', assetId: 'video', posterAssetId: 'image',
            resolvedSrc: videoRemote, posterResolvedSrc: imageRemote,
          },
        ],
      }],
    },
  };
  const source = state([
    { ...item('theme', null), kind: 'THEME', theme }, layoutItem, designItem,
  ]);
  source.wayfinding = {
    kiosk: { floorId: 'floor', x: 0, y: 0 }, building: { id: 'building', name: 'Building' },
    floors: [{ id: 'floor', level: 1, label: 'One', floorPlanAssetId: 'image', floorPlanUrl: imageRemote }],
    pois: [{ id: 'poi', iconAssetId: 'image', iconUrl: imageRemote }],
    routeNodes: [], routeEdges: [], attractPlaylist: nested, attractTheme: theme,
  };
  const local = rewritePlayerStateToLocalUris(
    source,
    {
      primary: new Map([['image', 'blob:image'], ['video', 'blob:video']]),
      pages: new Map([['document', ['blob:page']]]),
    },
    new Set([imageRemote, videoRemote, pageRemote]),
  );

  const [themeItem, rewrittenLayout, rewrittenDesign] = local.defaultPlaylist.items;
  assert.equal(themeItem.theme.elements[0].content.url, 'blob:image');
  assert.equal(themeItem.theme.elements[1].content.url, 'blob:video');
  assert.deepEqual(themeItem.theme.elements[2].content.pageUrls, ['blob:page']);
  assert.equal(themeItem.theme.elements[3].content.playlist.items[0].asset.url, 'blob:image');
  assert.equal(rewrittenLayout.layout.zones[0].playlist.items[0].asset.url, 'blob:image');
  assert.equal(rewrittenDesign.design.scenes[0].background.resolvedSrc, 'blob:image');
  assert.equal(rewrittenDesign.design.scenes[0].elements[1].resolvedSrc, 'blob:video');
  assert.equal(rewrittenDesign.design.scenes[0].elements[1].posterResolvedSrc, 'blob:image');
  assert.equal(local.wayfinding.floors[0].floorPlanUrl, 'blob:image');
  assert.equal(local.wayfinding.pois[0].iconUrl, 'blob:image');
});

function readySynchronization() {
  return { assets: [], verified: 0, failed: 0, cancelled: 0, ready: true };
}

test('persists a complete snapshot before returning it as ACTIVE and skips unchanged revisions', async () => {
  const events = [];
  let synchronizationCalls = 0;
  const synchronizer = {
    async synchronize() { synchronizationCalls += 1; events.push('synchronized'); return readySynchronization(); },
    async cancel() {}, dispose() {},
  };
  const prepared = {
    contentRevision: 'revision-a', state: state([]), assetStorageKeys: [], release() { events.push('released'); },
  };
  const preparer = { async prepare() { events.push('prepared'); return prepared; } };
  const persistence = {
    async load() { return undefined; },
    async commit(record) { events.push(`committed:${record.contentRevision}`); },
  };
  const coordinator = new BrowserPresentationActivationCoordinator(
    { namespace: 'screen-1' }, synchronizer, preparer, persistence, () => 123,
  );
  const manifest = {
    schemaVersion: 1, screenId: 'screen-1', contentRevision: 'revision-a', generatedAt: '',
    desiredState: state([]), assets: [], networkDependencies: [], packagedFonts: [],
  };

  const result = await coordinator.activate(manifest);
  events.push('returned');
  const unchanged = await coordinator.activate(manifest);

  assert.equal(result.status, 'ACTIVE');
  assert.equal(result.presentation, prepared);
  assert.deepEqual(events.slice(0, 4), ['synchronized', 'prepared', 'committed:revision-a', 'returned']);
  assert.equal(unchanged.status, 'ACTIVE');
  assert.equal(unchanged.unchanged, true);
  assert.equal(unchanged.presentation, null);
  assert.equal(synchronizationCalls, 1);
});

test('failed candidate does not prepare, persist, or replace the current presentation', async () => {
  let prepared = false;
  let committed = false;
  const coordinator = new BrowserPresentationActivationCoordinator(
    { namespace: 'screen-1' },
    {
      async synchronize() { return { assets: [], verified: 0, failed: 1, cancelled: 0, ready: false }; },
      async cancel() {}, dispose() {},
    },
    { async prepare() { prepared = true; throw new Error('must not run'); } },
    { async load() { return undefined; }, async commit() { committed = true; } },
  );

  const result = await coordinator.activate({
    schemaVersion: 1, screenId: 'screen-1', contentRevision: 'broken', generatedAt: '',
    desiredState: state([]), assets: [], networkDependencies: [], packagedFonts: [],
  });

  assert.equal(result.status, 'FAILED');
  assert.equal(result.presentation, null);
  assert.equal(prepared, false);
  assert.equal(committed, false);
});

test('restores a persisted source snapshot by rebuilding fresh local leases', async () => {
  const source = state([]);
  const restoredPresentation = {
    contentRevision: 'saved', state: source, assetStorageKeys: [], release() {},
  };
  const coordinator = new BrowserPresentationActivationCoordinator(
    { namespace: 'screen-1' },
    { async synchronize() { return readySynchronization(); }, async cancel() {}, dispose() {} },
    { async prepare(candidate) { assert.equal(candidate.desiredState, source); return restoredPresentation; } },
    {
      async load() {
        return {
          namespace: 'screen-1', contentRevision: 'saved', sourceState: source,
          assets: [], assetStorageKeys: [], activatedAt: 1,
        };
      },
      async commit() {},
    },
  );

  const result = await coordinator.restore();

  assert.equal(result.status, 'ACTIVE');
  assert.equal(result.restored, true);
  assert.equal(result.presentation, restoredPresentation);
});

test('a newer manifest supersedes an older candidate before preparation or commit', async () => {
  const pending = [];
  const committed = [];
  const synchronizer = {
    synchronize() { return new Promise(resolve => pending.push(resolve)); },
    async cancel() {}, dispose() {},
  };
  const preparer = {
    async prepare(candidate) {
      return {
        contentRevision: candidate.contentRevision, state: candidate.desiredState,
        assetStorageKeys: [], release() {},
      };
    },
  };
  const coordinator = new BrowserPresentationActivationCoordinator(
    { namespace: 'screen-1' }, synchronizer, preparer,
    { async load() { return undefined; }, async commit(record) { committed.push(record.contentRevision); } },
  );
  const candidate = revision => ({
    schemaVersion: 1, screenId: 'screen-1', contentRevision: revision, generatedAt: '',
    desiredState: state([]), assets: [], networkDependencies: [], packagedFonts: [],
  });

  const olderPromise = coordinator.activate(candidate('older'));
  const newerPromise = coordinator.activate(candidate('newer'));
  pending[0](readySynchronization());
  const older = await olderPromise;
  pending[1](readySynchronization());
  const newer = await newerPromise;

  assert.equal(older.status, 'SUPERSEDED');
  assert.equal(newer.status, 'ACTIVE');
  assert.deepEqual(committed, ['newer']);
});
