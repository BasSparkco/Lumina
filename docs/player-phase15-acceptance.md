# Lumina Player Phase 15 Acceptance Runbook

Use this runbook against the deployed Chromium/WebView player. Repository unit and integration
tests cannot prove Service Worker control, real OPFS persistence, hardware decoder behavior,
browser-process restart, or operating-system storage eviction.

## Required test setup

- Record the player bundle URL (`/assets/index-<hash>.js`), browser/WebView version, device model,
  OS, free disk space, network type, and test timestamp.
- Use a playlist with at least five different normalized MP4 videos. Record every asset ID,
  binary SHA-256/version, size, duration, resolution, frame rate, and bitrate.
- Open DevTools Network with Preserve log enabled. Do not enable Disable cache: synchronized media
  is OPFS-backed, but that option changes unrelated app-shell behavior and makes evidence noisier.
- Paste [the Phase 15 browser probe](../apps/player/test/manual/phase15-browser-probe.js) into the
  player console. After synchronization finishes, call `luminaPhase15.reset()` immediately before
  each measured scenario. Save evidence with `luminaPhase15.download()`.

Every successful offline/local scenario must report `localSourcesOnly: true`. After resetting at
the beginning of a playback-only window, it must report `mediaOriginRequestCount: 0`.

## Test A — 24-hour offline soak

1. Synchronize and activate the five-video playlist.
2. Confirm every visible/preload video source is `blob:` and reset the probe.
3. Disable the device network for 24 hours without closing the player.
4. Save probe JSON at the start, after each complete loop for the first ten loops, and at the end.

Pass conditions:

- No permanent black/frozen screen, skipped valid item, or `error` event.
- Zero media-origin requests and zero transferred media bytes.
- Every item continues advancing; bounded `stalled`/`waiting` events recover to `playing`.
- Dropped-frame ratio remains within the device qualification limit.
- Heap/renderer memory stabilizes; it does not grow monotonically per loop.

## Test B/F — cold restart while offline

1. While the playlist is `READY`, save a probe report and completely terminate the browser/WebView
   process. A page reload is insufficient.
2. Disable networking, restart the process, reinstall the console probe, and begin timing.
3. Confirm content appears from the last committed revision before any server timeout.

Pass conditions:

- The previous playlist starts within the agreed device startup target.
- Every video source is `blob:`; no media-origin request or redownload occurs.
- No blank synchronization screen replaces an already valid local presentation.
- The player reports `OFFLINE` and continues complete playlist loops.

## Test C/D — interrupted candidate and reconnect

1. Keep playlist A playing and publish playlist B containing at least one uncached large asset.
2. Throttle to 3 Mbps, begin B's download, then disconnect the network before it completes.
3. Confirm A continues locally for at least one full loop and B never becomes active.
4. Reconnect and inspect the media request. A valid partial should use `Range`; otherwise it must
   restart cleanly from byte zero.
5. Confirm B activates once, only after size/checksum/MIME/readability verification completes.

Pass conditions:

- A remains visible and locally playable throughout the failed candidate.
- No partial/corrupt B asset is rendered.
- Reconnect order is heartbeat, manifest, resumed/retried media, then atomic activation.
- The final downloaded byte count matches B's manifest size and its SHA-256 version.

## Test E — ten multi-video loops

1. Synchronize five unique videos and wait for `READY`.
2. Record the initial media-origin request and byte count, then reset the probe.
3. Run ten complete playlist loops without publishing or refreshing.
4. Save reports after every loop.

Pass conditions:

- Exactly one successful full transfer per unique binary version during synchronization.
- Zero media-origin requests during the ten measured playback loops.
- No stuck item, permanent black frame, recovery exhaustion, `skip`, or `fallback` event.
- Transition delay stays within the agreed hardware budget.
- Object URL/video-element counts and memory stabilize instead of increasing per loop.

## Test G — decoder-stall recovery

This requires a controlled test build or browser automation that can freeze observed progress
without raising a media `error`. Do not corrupt production media to simulate it.

Pass conditions:

- After 10 seconds without progress, the watchdog emits `recovery` and recreates the local slot
  once (`generation: 1`).
- If progress remains absent, a multi-item playlist advances; a single-item playlist shows the
  explicit fallback. The screen never stays permanently black.
- Recovery/failure telemetry reaches the backend once Phase 12's deferred playback fields exist.

## Slow/large/fleet minimum

Before wider rollout, run one representative worst case rather than the full combinatorial matrix:

- one 250 MB or larger normalized video;
- 3 Mbps throttling;
- ten players synchronizing simultaneously;
- playlist A looping locally while candidate B downloads.

Record API/storage bandwidth, worker/API CPU and memory, renderer memory, request/byte counts,
download completion time, heartbeat latency, and activation time.

## Evidence record

| Field | Result |
|---|---|
| Player build hash | |
| Browser/WebView and OS | |
| Device model/hardware tier | |
| Test playlist and asset versions | |
| Tests A–G pass/fail | |
| Media-origin requests during loops | |
| Media bytes during loops | |
| Offline cold-start time | |
| Dropped/total video frames | |
| Initial/final renderer memory | |
| Interrupt offset and resumed Range | |
| Logs/probe JSON location | |
| Operator/date | |

Do not mark Phase 15 production-qualified until the evidence table and probe JSON/logs are attached
for every supported hardware tier.
