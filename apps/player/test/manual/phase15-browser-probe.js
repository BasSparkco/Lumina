/*
 * Lumina Phase 15 manual Chromium/WebView probe.
 * Paste this whole file into the deployed player's DevTools console, then use:
 *   luminaPhase15.reset()   // after synchronization, immediately before the measured scenario
 *   luminaPhase15.report()  // inspect evidence
 *   luminaPhase15.download()// save JSON evidence
 *   luminaPhase15.stop()    // remove observers/timers
 */
(() => {
  globalThis.luminaPhase15?.stop?.();

  const startedAt = new Date().toISOString();
  const videoIds = new WeakMap();
  const attachedVideos = new WeakSet();
  const events = [];
  const resources = [];
  const samples = [];
  let nextVideoId = 1;
  let resetAt = performance.now();

  const sourceKind = source => {
    if (!source) return 'none';
    if (source.startsWith('blob:')) return 'blob';
    if (source.startsWith('file:')) return 'file';
    if (source.startsWith('data:')) return 'data';
    return 'remote';
  };

  const safeResourceName = value => {
    try {
      const url = new URL(value, location.href);
      return `${url.origin}${url.pathname}`;
    } catch {
      return value;
    }
  };

  const isMediaOriginRequest = entry => {
    const path = safeResourceName(entry.name).toLowerCase();
    return path.includes('/v1/media/');
  };

  const videoId = video => {
    if (!videoIds.has(video)) videoIds.set(video, nextVideoId++);
    return videoIds.get(video);
  };

  const recordVideoEvent = (video, type) => {
    const quality = video.getVideoPlaybackQuality?.();
    events.push({
      atMs: Math.round(performance.now() - resetAt),
      type,
      videoId: videoId(video),
      sourceKind: sourceKind(video.currentSrc),
      currentTime: video.currentTime,
      readyState: video.readyState,
      networkState: video.networkState,
      paused: video.paused,
      totalVideoFrames: quality?.totalVideoFrames ?? null,
      droppedVideoFrames: quality?.droppedVideoFrames ?? null,
      mediaErrorCode: video.error?.code ?? null,
    });
  };

  const attachVideo = video => {
    if (attachedVideos.has(video)) return;
    attachedVideos.add(video);
    videoId(video);
    for (const type of ['loadstart', 'loadeddata', 'canplay', 'playing', 'waiting', 'stalled', 'ended', 'error']) {
      video.addEventListener(type, () => recordVideoEvent(video, type));
    }
  };

  const attachAllVideos = root => {
    if (root instanceof HTMLVideoElement) attachVideo(root);
    root.querySelectorAll?.('video').forEach(attachVideo);
  };

  attachAllVideos(document);
  const mutationObserver = new MutationObserver(records => {
    for (const record of records) record.addedNodes.forEach(node => attachAllVideos(node));
  });
  mutationObserver.observe(document.documentElement, { childList: true, subtree: true });

  const resourceObserver = new PerformanceObserver(list => {
    for (const entry of list.getEntries()) {
      if (!isMediaOriginRequest(entry)) continue;
      resources.push({
        atMs: Math.round(entry.startTime - resetAt),
        name: safeResourceName(entry.name),
        initiatorType: entry.initiatorType,
        durationMs: Math.round(entry.duration),
        transferSize: entry.transferSize,
        encodedBodySize: entry.encodedBodySize,
        decodedBodySize: entry.decodedBodySize,
      });
    }
  });
  resourceObserver.observe({ type: 'resource', buffered: false });

  const sample = () => {
    const memory = performance.memory;
    samples.push({
      atMs: Math.round(performance.now() - resetAt),
      connectivity: document.documentElement.dataset.connectivityState ?? null,
      online: navigator.onLine,
      jsHeapBytes: memory?.usedJSHeapSize ?? null,
      videos: [...document.querySelectorAll('video')].map(video => {
        const quality = video.getVideoPlaybackQuality?.();
        return {
          videoId: videoId(video),
          sourceKind: sourceKind(video.currentSrc),
          currentTime: video.currentTime,
          duration: Number.isFinite(video.duration) ? video.duration : null,
          readyState: video.readyState,
          networkState: video.networkState,
          paused: video.paused,
          ended: video.ended,
          totalVideoFrames: quality?.totalVideoFrames ?? null,
          droppedVideoFrames: quality?.droppedVideoFrames ?? null,
        };
      }),
    });
    if (samples.length > 20_000) samples.splice(0, samples.length - 20_000);
  };
  sample();
  const sampleTimer = setInterval(sample, 5_000);

  const connectivityEvent = type => events.push({
    atMs: Math.round(performance.now() - resetAt), type, online: navigator.onLine,
  });
  const onOnline = () => connectivityEvent('browser-online');
  const onOffline = () => connectivityEvent('browser-offline');
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);

  const api = {
    reset() {
      events.length = 0;
      resources.length = 0;
      samples.length = 0;
      resetAt = performance.now();
      sample();
      return 'Phase 15 measurements reset';
    },
    report() {
      const latest = samples.at(-1);
      const allSources = samples
        .flatMap(entry => entry.videos.map(video => video.sourceKind))
        .filter(kind => kind !== 'none');
      const firstHeap = samples.find(entry => entry.jsHeapBytes !== null)?.jsHeapBytes ?? null;
      const lastHeap = [...samples].reverse().find(entry => entry.jsHeapBytes !== null)?.jsHeapBytes ?? null;
      return {
        probeStartedAt: startedAt,
        measuredSeconds: Math.round((performance.now() - resetAt) / 100) / 10,
        build: [...document.scripts].map(script => script.src).find(src => /\/assets\/index-/.test(src)) ?? null,
        connectivity: latest?.connectivity ?? document.documentElement.dataset.connectivityState ?? null,
        browserOnline: navigator.onLine,
        localSourcesOnly: allSources.length > 0 && allSources.every(kind => kind === 'blob' || kind === 'file'),
        mediaOriginRequestCount: resources.length,
        mediaOriginTransferredBytes: resources.reduce((total, entry) => total + entry.transferSize, 0),
        videoEventCounts: Object.fromEntries(
          [...new Set(events.map(event => event.type))]
            .map(type => [type, events.filter(event => event.type === type).length]),
        ),
        jsHeapGrowthBytes: firstHeap === null || lastHeap === null ? null : lastHeap - firstHeap,
        latestSample: latest ?? null,
        resources: [...resources],
        events: [...events],
        samples: [...samples],
      };
    },
    download() {
      const blob = new Blob([JSON.stringify(api.report(), null, 2)], { type: 'application/json' });
      const anchor = document.createElement('a');
      anchor.href = URL.createObjectURL(blob);
      anchor.download = `lumina-phase15-${new Date().toISOString().replaceAll(':', '-')}.json`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(anchor.href), 0);
    },
    stop() {
      clearInterval(sampleTimer);
      mutationObserver.disconnect();
      resourceObserver.disconnect();
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      if (globalThis.luminaPhase15 === api) delete globalThis.luminaPhase15;
    },
  };

  globalThis.luminaPhase15 = api;
  console.info('[lumina-phase15] probe installed; call luminaPhase15.reset() before each scenario');
})();
