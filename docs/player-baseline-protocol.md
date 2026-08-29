# Lumina Player — Baseline Measurement Protocol

Status: protocol prepared on 2026-08-27; device measurements are pending a controlled test run.

Do not fill this document with estimates. Every result must identify the player build, browser or
WebView, device, network profile, playlist revision, and media files used.

## 1. Purpose

This protocol creates the Phase 1 baseline that later offline-first milestones must beat. It tests
the current Phase 0 implementation and is intended to be repeated after each storage, download,
activation, and transition milestone.

## 2. Required test environments

Run on at least:

1. The lowest-spec supported production device.
2. A representative production device.
3. Desktop Chromium as a diagnostic reference, not as a substitute for device results.

Record:

| Field | Value |
| --- | --- |
| Run ID | `YYYYMMDD-device-scenario-runN` |
| Git commit / build identifier | Pending |
| Player URL | Pending |
| Device model and RAM | Pending |
| OS / WebView / browser version | Pending |
| Display resolution | Pending |
| Network profile | Pending |
| Service Worker version/activation time | Pending |
| Available storage before run | Pending |

Use a fresh pairing or document why an existing paired screen is required. Disable unrelated
background applications and preserve the raw browser network export, player console log, and API
media request log with the same Run ID.

## 3. Media fixture matrix

Prepare normalized, supported-codec files with immutable URLs:

| Fixture | Target size | Required metadata |
| --- | ---: | --- |
| V20 | 20 MB | duration, dimensions, codec/profile/level, pixel format, bitrate, frame rate, audio codec |
| V100 | 100 MB | same |
| V250 | 250 MB | same |
| V500 | 500 MB, if supported | same |
| P5 | Five different videos | same for every item; fixed playlist order and duration policy |
| PREUSE | One video referenced several times/playlists | proves local reuse behavior |

Store the exact byte count and SHA-256 of every fixture in the run evidence. Do not compare runs
that silently use different encodes.

## 4. Network scenarios

Run each applicable fixture under:

| Scenario | Definition |
| --- | --- |
| LAN | Normal production-like unthrottled connection. |
| SLOW | Documented throttling values for down/up bandwidth, latency, and packet loss. |
| INTERRUPT | Disconnect during the first full transfer, remain offline for 30 seconds, reconnect. |
| OFFLINE-AFTER-WARM | Complete one successful loop/synchronization, then remove all Internet access. |
| OFFLINE-RESTART | After warm synchronization, close/restart the player while still offline. |
| STORAGE-PRESSURE | Run with documented low free storage or an enforced browser quota fixture. |

Use the same throttle values between milestone comparisons. Browser presets named only “Slow 3G”
are insufficient unless their actual values are recorded.

## 5. Cache state before each run

Classify each run as one of:

- `COLD`: Cache Storage and player IndexedDB cleared; Service Worker active after reload.
- `WARM`: Same content completed once and cache was not cleared.
- `RESTARTED_WARM`: Browser/player restarted after a completed warm run.

Never mix cold and warm loops in one aggregate. Capture the Cache Storage entry names and sizes
before and after the run.

## 6. Metrics and definitions

| Metric | Definition |
| --- | --- |
| First-frame time | Milliseconds from playlist/item activation to the first `playing` event with advancing `currentTime`. |
| Transition black time | Longest continuous interval without the outgoing frame or an incoming decoded frame. |
| Rebuffer event | Playback was progressing, then advances by less than 50 ms for at least two seconds while not paused/ended/hidden. |
| Permanent stall | No progress until watchdog recovery/skip, manual action, or test timeout. |
| Media-origin request | Any request matching the API `/v1/media/...` asset route, counted by method/status/range. |
| Duplicate transfer | Overlapping origin requests for the same immutable URL during one run. |
| Loop request count | Media-origin requests beginning after the first complete playlist loop. |
| Downloaded bytes | Sum of transferred response bytes from network/API logs, not decoded media size. |
| Cache bytes | Browser storage estimate plus enumerated cache response sizes where exposed. |
| Recovery time | Time from disconnection/stall to advancing video or bounded item skip/fallback. |
| Memory | Browser/player process working set at fixed sample points and peak during the run. |
| CPU | Average and peak player process CPU over the same fixed windows. |

For media requests, record `200`, `206`, aborted/cancelled, transferred bytes, Range header, start,
finish, and duration. A visual “looks smooth” result without request evidence does not pass.

## 7. Required scenarios

### B1 — Cold single video

Run V20, V100, V250, and V500 where supported.

1. Start from `COLD`.
2. Start recording network, console, CPU, and memory before opening playback.
3. Play five complete loops.
4. Record first-frame time, requests, transferred bytes, cache growth, rebuffering, CPU, and memory.
5. Confirm whether loops 2–5 generate media-origin requests.

### B2 — Warm single video restart

1. Begin immediately after B1 without clearing storage.
2. Restart the browser/player.
3. Play five complete loops.
4. Record whether any media-origin request occurs and whether playback begins while offline.

### B3 — Five-video playlist

1. Start P5 from `COLD`.
2. Run ten complete playlist loops.
3. Record every transition, request, recovery, skipped item, memory sample, and decoder error.
4. Repeat as `WARM` and `RESTARTED_WARM`.

### B4 — Shared-asset reuse

1. Reference PREUSE several times and in nested content where supported.
2. Start from `COLD`.
3. Confirm the number of transfers for the one URL and whether concurrent requests overlap.

### B5 — Interrupted first download

1. Start a cold V250 or V500 transfer.
2. Disconnect after 25–50% of the observed transfer time.
3. Stay offline for 30 seconds, then reconnect.
4. Record partial bytes wasted, retry timing, blank/fallback behavior, and time to recovery.

### B6 — Offline after warm

1. Warm P5 completely.
2. Remove Internet access.
3. Run ten loops.
4. Restart while still offline and repeat.

### B7 — Decoder zero-progress

Use the platform's supported fault-injection method or a controlled malformed/unsupported fixture.
Confirm that a direct `ZonePlayer` video recovers or skips within its bound. Separately test direct
Theme and Design videos; the current-flow review predicts that those paths do not yet share the
same watchdog.

### B8 — Publish during playback

1. Warm and play revision A.
2. Publish revision B containing at least one cold video.
3. Record exactly when A disappears, when B first displays, and whether any blank interval occurs.
4. Interrupt the B download and confirm what remains visible.

This scenario documents the current non-atomic activation behavior and becomes the key comparison
for the manifest/activation milestones.

## 8. Evidence collection

For each run retain:

- Browser network export/HAR where supported.
- Player console logs containing `[lumina-media-cache]` and `[lumina-video-playback]`.
- API reverse-proxy or application media request logs.
- Screen recording with a visible synchronized timer for transition analysis.
- CPU/memory capture from the device or browser process.
- Cache Storage and IndexedDB screenshots/exports before and after.
- The exact playlist/state JSON used for the run, with credentials removed.

Never include player tokens, Authorization headers, cookies, or environment secrets in committed
evidence.

## 9. Result sheet

Copy this table once per run:

| Metric | Result |
| --- | --- |
| Run ID | Pending |
| Scenario / fixture / cache state | Pending |
| First-frame time | Pending |
| Maximum transition black time | Pending |
| Rebuffer count and total duration | Pending |
| Media requests: 200 / 206 / aborted | Pending |
| Requests after first complete loop | Pending |
| Duplicate concurrent transfers | Pending |
| Network bytes transferred | Pending |
| Cache bytes before / after | Pending |
| CPU average / peak | Pending |
| Memory start / peak / end | Pending |
| Recovery result and time | Pending |
| Playback skips/fallbacks | Pending |
| Notes / evidence locations | Pending |

## 10. Phase 0 canary pass criteria

The current stabilization build may proceed beyond canary only if all of these are demonstrated on
the target device and corroborated by request logs:

- One cold immutable video URL has at most one active origin transfer at a time.
- After a successful cache fill, later loops generate zero media-origin requests.
- An unchanged warm video survives player restart without redownloading.
- A direct playlist video cannot remain stalled indefinitely.
- Failed synchronization does not produce an unbounded blank/frozen presentation.

Failure of the last criterion is expected to drive the atomic activation/last-good-content work;
it must not be waived merely because the cache request count improved.
