# Lumina Player Repair Plan

> **Document status:** approved repair direction, updated through the local Phase 15 test implementation
> on 2026-08-28. This plan replaces the assumption that the current Service Worker is a sufficient
> persistent video cache. It is not. The production player must be treated as online-streaming
> until the synchronization, local-storage, activation, and recovery milestones below pass their
> acceptance tests.

## Delivery Progress — 2026-08-28

| Phase | Finished locally | Still required before production completion |
|---|---|---|
| Phase 0 — stabilization | Cache ownership/streaming and bounded renderer recovery | Canary and real-device failure/network verification |
| Phase 1 — current flow | Architecture map and baseline protocol | Execute and attach lowest-tier/production-device measurements |
| Phase 2 — manifest | API contract, integrity metadata, worker persistence/backfill command, dependency closure, and tests | Migrate, backfill, deploy compatibility endpoint, and audit production manifests |
| Phase 3 — persistent storage | OPFS prototype, IndexedDB metadata, lifecycle, reconciliation, cleanup, persistence/quota diagnostics, and reset integration | Run the full device benchmark and qualify OPFS or a fallback adapter |
| Phase 4 — download manager | Prioritized bounded queues, single-owner joining, resumable staging, retries/timeouts, cancellation, progress, and tests | Run real device/fleet interruption and capacity tests |
| Phase 5 — asset verification | Streaming SHA-256, size/signature/decoder checks, verified-only promotion, persisted failures, strict readiness composition, and tests | Run real OPFS/device corruption and performance tests |
| Phase 6 — atomic activation | Complete local-URI rewriting, leased presentation lifecycle, decoder gate, transactional snapshot, restart restoration, safe rollback, and live manifest integration | Run crash/offline/playlist-loop tests on production hardware |
| Phase 7 — offline playback | Explicit connection state, immediate local boot, bounded sync, offline request suppression, cached widget fallbacks, ordered reconnect sync, and diagnostics/tests | Run zero-network restart and repeated-loop proof on production hardware |
| Phase 8 — playback resolver | Done as part of Phase 6's local-URI rewrite: `presentation-preparer.ts` resolves the whole state tree to local `blob:` URIs once at activation (not per-render), with a hard invariant rejecting any remaining remote URL. `ZonePlayer` renders `asset.url` unchanged. | Nothing outstanding — verified by the 8/8 `test:presentation` suite |
| Phase 9 — preload/transition | Satisfied as a side effect of Phase 8: `preload="auto"` and the existing next-item warm-up now warm local blobs, not network URLs, with zero code changes needed | — |
| Phase 10–11 — storage lifecycle/cleanup | `MediaStorage.cleanup()` (LRU + age eviction) existed but was never called anywhere — dead code. Wired into `PlayerPage.tsx` on 2026-08-28: runs after every activation and every 30 min, retains only the live presentation's assets, evicts anything unused 7+ days or once usage crosses 80% of quota | Verify eviction against a real multi-GB local store on device |
| Phase 12 — telemetry | Core sync/readiness/storage heartbeat fields and database persistence implemented | Add playback recovery/dropped-frame/remote-request fields and the admin operational-status UI |
| Phase 13 — error handling | Most listed failure scenarios are covered (timeouts, offline suppression, 401/404 revocation, corrupt/partial download rejection, restart-mid-download via `restore()`) | The manifest integrity gate (Phase 5) still fails the *entire* manifest if any one referenced asset lacks verified metadata, instead of degrading per-asset — see the new guardrail §53 below |
| Phase 14 — restart recovery | Done: `coordinator.restore()` rebuilds fresh local leases from the persisted snapshot on every boot before any network call | Run the real-hardware restart tests in Phase 15 |
| Phase 15 — testing | 30 deterministic player tests, including composed download→verify→activate→offline-restore/resume integration and cleanup-policy coverage; deployed-browser probe/runbook added | Execute and attach real Chromium/WebView Tests A–G, 24-hour soak, large/slow/fleet minimum, and supported-hardware evidence |

“Finished locally” means implemented and validated in this repository. It does not mean deployed,
migrated, backfilled, or approved on signage hardware. PlayerPage now consumes `/player/manifest`
and activates locally downloaded and verified media atomically. It now restores that presentation
before attempting a bounded network sync and suspends known-impossible network work while offline;
production acceptance still
requires the real-device, offline, crash, and rollout tests below.

## Outcome Required by This Repair

When this project is finished, an operator must be able to publish either one video or a playlist
containing many videos and get continuous, predictable playback:

- Each unchanged media file is downloaded exactly once per player, not once per playlist loop.
- A playlist never becomes active until every required local media file is ready and verified.
- Normal playback reads no video bytes from the network.
- The next video is prepared from local storage before the current video ends.
- A stalled or failed decoder cannot leave the screen frozen indefinitely.
- Restarting the browser, WebView, native shell, or device does not redownload valid media.
- Disconnecting the network after synchronization does not change playback behavior.

"Smooth for any video" means that every accepted upload is normalized into a documented playback
profile supported by the target hardware. Unsupported or corrupt input must fail during media
processing or synchronization; it must never be published raw and allowed to fail on the screen.

## Roadmap Tracking Correction

Until this document's Definition of Done passes, the main roadmap items "Offline cache" and
"Video playback with preloading" must be considered reopened/in progress. Cached player-state JSON
and browser-assisted remote playback do not satisfy those items. They may be marked complete again
only after the local multi-video and offline-restart acceptance tests pass on production hardware.

## 1. Purpose

This document defines the implementation plan for repairing the current Lumina player architecture before introducing any external CDN or storage platform such as Cloudflare.

The main objective is to make the player **offline-first** and suitable for reliable digital signage operation.

The player must not depend on continuous network access while displaying scheduled content.

The network should be required only for:

- Player registration and authentication.
- Configuration synchronization.
- Playlist synchronization.
- Downloading new or updated media assets.
- Sending heartbeat, telemetry, and playback status.
- Receiving future remote-control commands.

Once the required media has been synchronized successfully, playback must use local persistent storage.

---

## 2. Current Problem

The current player can render content correctly, but its media delivery model is not robust enough for production digital signage.

The main issue is that video playback currently relies on network URLs.

The current video preload behavior improves transitions but does not provide a true persistent media cache.

Conceptually, the current flow is close to:

```text
Playlist
   |
   v
Remote asset URL
   |
   v
HTML <video>
   |
   v
Browser/network buffering
   |
   v
Playback
```

This causes several risks:

- Slow video startup.
- Buffering when network quality drops.
- Repeated downloads.
- Increased bandwidth consumption.
- Increased load on the Lumina server.
- Unpredictable browser cache behavior.
- Playback interruption during connectivity problems.
- Poor behavior in locations with unstable internet.
- Difficulty scaling to large numbers of screens.

This architecture must be corrected before optimizing the delivery infrastructure.

---

## 3. Target Architecture

The Lumina player must become an **offline-first synchronized player**.

Target flow:

```text
Lumina API
    |
    | playlist + asset manifest
    v
Player Sync Manager
    |
    +------------------------------+
    |                              |
    | Asset already valid?         |
    |                              |
    +----------+-------------------+
               |
        +------+------+
        |             |
       YES            NO
        |             |
        |             v
        |       Download asset
        |             |
        |       Verify integrity
        |             |
        +-------------+
               |
               v
        Local Media Store
               |
               v
        Playback Renderer
               |
               v
             Screen
```

Playback must use local files whenever possible.

The remote media URL must be treated as a synchronization source, not as the primary playback source.

---

## 4. Architectural Rule

The most important rule for the repaired player is:

> Media should be downloaded, verified, stored locally, and played from local persistent storage. Network access should be required only for synchronization and updates.

This rule must remain true across:

- Web player.
- Android player.
- Flutter shell.
- Future Windows player.
- Future Linux player.
- Future embedded signage devices.

Additional non-negotiable rules:

1. **One asset version, one network transfer.** A cache miss must never start a full-file download
   and a second range download for the same version at the same time.
2. **No incidental caching.** Rendering a remote URL and hoping that the browser or Service Worker
   retains it does not count as synchronization.
3. **No activation on URL receipt.** Receiving server state is not proof that its media is playable.
4. **No full-file Blob reconstruction per range request.** Large cached videos must remain
   disk-backed during playback.
5. **No permanent media wait.** Lack of playback progress must trigger bounded recovery.

---

# Phase 0 — Immediate Production Stabilization

This phase reduces the current repeated-download and frozen-video behavior while the full
offline-first architecture is being built. It is a temporary safety layer, not the final design.

## 0.0 Implementation Status — 2026-08-27

Implemented locally:

- [x] Explicit local video-cache metadata for `cachedAt`, `lastUsedAt`, and byte size.
- [x] Metadata-based expiry and least-recently-used eviction; a missing origin `Date` header no
  longer makes a new video immediately stale.
- [x] One shared in-flight full download per video URL. Range requests join that transfer instead
  of starting a second origin request.
- [x] Cached byte-range responses are streamed from Cache Storage without reconstructing the
  complete video as an in-memory Blob.
- [x] Cache-fill work is attached to the fetch-event lifetime.
- [x] Structured diagnostics for cache hits, misses, downloads, failures, and eviction.
- [x] Bounded player recovery for video start timeout, stalled progress, and media errors.
- [x] One local remount attempt followed by playlist-item skip or a visible single-item fallback.
- [x] Changed-file lint, TypeScript checking, and the production player build pass.

Still required before Phase 0 can be called production-verified:

- [ ] Deploy as a controlled canary and confirm Service Worker activation on the target device.
- [ ] Replay unchanged single-video and multi-video playlists and inspect origin/API request logs.
- [ ] Confirm one origin transfer per uncached URL and zero additional transfers on later loops.
- [ ] Exercise interrupted downloads, decoder stalls, offline restart, and storage pressure.
- [ ] Confirm the last working presentation remains visible throughout failed synchronization.

Phase 0 reduces the immediate failure modes, but it does not replace the later manifest-driven,
verified, atomic offline-first design. In particular, Cache Storage remains the temporary binary
store until the persistent download manager and local asset resolver are implemented.

## 0.1 Confirmed Current Failures

The 2026-08-27 production investigation confirmed:

- One unchanged 40,201,205-byte MP4 was requested 107 times in six hours.
- 121 media-origin requests occurred in that window; 36 transfers were aborted.
- The same cache miss produced simultaneous full `200` and range `206` transfers.
- Full transfers took tens of seconds, so playlist transitions happened before downloads completed.
- The deployed Service Worker cached a full response and then could delete it immediately because
  its cleanup code treated a missing cross-origin `Date` response header as timestamp zero.
- Cached range handling used Workbox `createPartialResponse()`, which materializes the entire cached
  response as a Blob before slicing it. This is not acceptable for large signage videos.

## 0.2 Required Hotfixes

Before adding new architecture:

1. Stop classifying entries with a missing `Date` header as stale. Use explicit local metadata
   timestamps instead of response-header availability.
2. Remove the full-download-plus-range-download race. Only one transfer may own an asset version.
3. Do not run asynchronous background cache fills without attaching them to the Service Worker
   event lifetime.
4. Add temporary logging for cache hit/miss, download start/finish/failure, asset URL/version,
   bytes, duration, and eviction reason.
5. Add `<video>` error and zero-progress recovery so a failed `playFullVideo` item cannot wait
   forever for an `ended` event that will never arrive.
6. Keep the last working content visible while uncached content is being prepared.

## 0.3 Hotfix Acceptance

- Replaying the same synchronized video produces zero additional media-origin requests.
- A cache fill produces at most one active origin transfer for that asset version.
- A failed transfer does not blank or permanently freeze a previously working screen.
- These claims must be verified in browser automation and API request logs, not only by visual
  observation.

---

# Phase 1 — Document the Current Player Flow

## 1.0 Implementation Status — 2026-08-27

- [x] Source-verified current architecture map written to `docs/player-current-flow.md`.
- [x] Synchronization, IndexedDB, media URL, renderer, preload, retry, heartbeat, refresh,
  connectivity, deletion, and Service Worker paths documented.
- [x] End-to-end sequence diagram added.
- [x] Reproducible baseline protocol and results sheet written to
  `docs/player-baseline-protocol.md`.
- [ ] Execute the baseline matrix on the lowest supported and representative production devices.
- [ ] Attach sanitized network, console, API-log, CPU, memory, and storage evidence to each run.

The documentation portion is complete. Phase 1 measurement is not complete until real device
results replace the pending fields; desktop or estimated values cannot close that requirement.

## 5. Map the Existing Player Architecture

Before modifying behavior, document the current flow from playlist retrieval to media playback.

Identify:

- Playlist synchronization entry point.
- Player state storage.
- IndexedDB usage.
- Media URL generation.
- `ZonePlayer` media rendering.
- Video preload logic.
- Image preload logic.
- Current retry behavior.
- Heartbeat flow.
- Online/offline detection.
- Player refresh behavior.
- Playlist refresh interval.
- Asset deletion behavior.
- Any existing service worker behavior.

Deliverable:

```text
docs/player-current-flow.md
```

The document should include a simple sequence diagram.

---

## 6. Establish Baseline Measurements

Record the current behavior before changing the implementation.

Test with:

- 20 MB video.
- 100 MB video.
- 250 MB video.
- 500 MB video if currently supported.
- Multiple videos in one playlist.
- Slow connection.
- Temporary network interruption.
- Complete internet disconnection after playback starts.

Measure:

- Time until first video frame.
- Rebuffer events.
- Media requests per playlist loop.
- Total downloaded data.
- CPU usage.
- Memory usage.
- Disk usage.
- Player recovery after connection loss.

These measurements become the baseline for later comparison.

---

# Phase 2 — Asset Manifest

## 2.0 Implementation Status — 2026-08-28

Implemented locally:

- [x] Additive authenticated `GET /player/manifest` endpoint; existing `/player/state` consumers
  remain compatible.
- [x] Shared versioned `PlayerContentManifest` contract containing desired state, stable content
  revision, verified media binaries, network-required apps, and packaged-font IDs.
- [x] Normalized `AssetBinary` metadata keyed by asset, binary kind, and ordinal.
- [x] SHA-256, final byte size, MIME type, storage key, and binary version for images, videos,
  audio, and every rendered document page.
- [x] Video processing now stores the final transcoded MP4 size instead of the original upload
  size.
- [x] Recursive dependency collection across direct playlists, schedules, emergency/default
  content, nested themes/layouts/designs, document pages, wayfinding assets, and attract content.
- [x] Design background and wayfinding media retain stable asset IDs alongside hydrated URLs.
- [x] Online-only APP content is emitted as `networkRequired` and never counted as offline-ready.
- [x] Cyclic/depth-truncated or unresolved hydrated dependency graphs are rejected instead of
  producing a falsely complete manifest.
- [x] `contentRevision` uses canonical desired state plus an ordered binary-version list; response
  generation time is excluded.
- [x] A one-time `backfill:asset-integrity` worker command is available for existing READY assets.
- [x] Manifest tests cover canonical stability, ordered changes, nested closure, priority,
  document pages, network-required apps, binary-version stability, and missing-integrity refusal.

Required before production activation:

- [x] Apply the `AssetBinary` migration — auto-applied 2026-08-28 on container boot
  (`20260827143000_add_asset_binary_integrity`).
- [x] Run and audit the integrity backfill against production object storage — run by hand
  2026-08-28 after the migration-without-backfill gap caused a fleet-wide `409` (see guardrail
  §53); 16/16 READY binary assets backfilled, 0 failures.
- [x] Confirm every referenced READY binary has a 64-character SHA-256 and correct final size —
  verified via a direct manifest fetch returning `200` post-backfill.
- [ ] Deploy the endpoint as a compatibility-only release and inspect manifests for representative
  single-video, multi-video, nested-layout/theme/design, wayfinding, and emergency screens.
- [x] ~~Keep PlayerPage on `/player/state` until Phases 3–5 provide persistent storage, verified
  downloads, and atomic activation~~ — superseded: Phases 3–6 are complete and covered by 25/25
  passing tests (see Phase 3/5/6/8 status sections), and `PlayerPage.tsx` already runs on
  `/player/manifest` end-to-end via the activation coordinator.

The API contract is implemented and now live end-to-end. New assets uploaded going forward get
`AssetBinary` written automatically by the media processor — the backfill was a one-time gap for
assets that predated that code, not a recurring step.

## 7. Introduce an Explicit Asset Manifest

The playlist synchronization response must expose enough information for the player to determine whether an asset already exists locally and whether it is still valid.

The API should return one versioned content snapshot. A playlist ID alone is insufficient because
playlist items, layouts, themes, designs, schedules, emergency content, and referenced assets can
change independently.

Recommended response structure:

```ts
interface PlayerContentManifest {
  schemaVersion: 1;
  screenId: string;

  // Changes whenever any playable configuration or reachable binary dependency changes.
  contentRevision: string;
  generatedAt: string;

  desiredState: PlayerState;
  assets: PlayerAssetManifestItem[];
}

interface PlayerAssetManifestItem {
  assetId: string;
  type: "video" | "image" | "audio" | "document-page" | "font" | "other";

  remoteUrl: string;

  // Changes only when the binary bytes change. Renaming an asset must not change this value.
  binaryVersion: string;
  sha256: string;

  mimeType: string;
  fileSize: number;

  priority: "current" | "next" | "scheduled" | "fallback";
}
```

The exact schema may be adjusted to match the existing backend model.

The important fields are:

- Stable asset ID.
- Remote source.
- Binary-specific version identifier.
- SHA-256 checksum generated once by the backend/worker.
- File size.
- MIME type.
- Content revision covering the complete desired player state.

`fileSize` and `sha256` are required for production media. Optional integrity fields make atomic
activation impossible because the player cannot distinguish a complete file from a truncated one.

## 7.1 Manifest Dependency Closure

The server must recursively collect every locally playable dependency reachable from the desired
screen state, deduplicate by `assetId + binaryVersion`, and reject cyclic content graphs beyond the
existing safe depth limit.

The manifest must include:

- Direct playlist assets.
- Every playlist and direct asset inside layout zones.
- Theme image, video, document, and nested-playlist elements.
- Design image/video elements, video posters, and image/video scene backgrounds.
- Every rasterized page of a document.
- Wayfinding floor plans and POI icons.
- Emergency content, configured fallback content, attract content, and content scheduled within a
  configurable look-ahead window.
- Locally packaged fonts required by rendered content.

Online-only application content such as YouTube must be marked explicitly as `networkRequired` and
must not be allowed to masquerade as offline-ready media.

## 7.2 Content Revision

Generate `contentRevision` from a canonical representation of the complete hydrated desired state
plus its ordered `assetId + binaryVersion` list. It must change for item order, duration, crop,
mute, layout/theme/design content, schedule, emergency, or binary changes. It must remain stable for
an identical response.

The player stores this revision with the candidate and active snapshots. Heartbeats report both the
desired revision and the actually active revision.

---

## 8. Asset Identity

The player must never determine asset freshness only from the URL.

Each asset must have a stable identifier.

Recommended key:

```text
tenantId + assetId + binaryVersion
```

Example:

```text
tenant_42/video_91/sha256-abcd...
```

This prevents stale media from being reused incorrectly.

---

## 9. Asset Version Strategy

Use one authoritative binary version mechanism.

Preferred options:

1. Persisted content checksum.
2. Immutable storage-object revision or ETag.
3. Dedicated binary version field.

Preferred long-term approach:

```text
SHA-256 checksum
```

Do not use the general Asset `updatedAt` field. Metadata-only edits such as renaming an asset must
not force a large video download, while replacing/transcoding bytes must always change the binary
version.

The player should not calculate hashes unnecessarily during every startup.

The worker should calculate the checksum and final byte size once after the final transcoded object
is produced, persist both values, and the server should provide them. The existing video worker must
also update `sizeBytes` to the final transcoded file size rather than retaining the original upload
size.

---

# Phase 3 — Local Persistent Media Storage

## 3.0 Implementation Status — 2026-08-28

Implemented locally:

- [x] Dedicated `MediaStorage` contract outside React with verified-only stable local URI
  resolution, streamed staging, logical-asset removal, listing, usage, cleanup, reconciliation, and
  durable storage operations.
- [x] OPFS prototype for Chromium stores full media as disk-backed files rather than reconstructing
  a complete Blob in JavaScript for each range or seek.
- [x] Separate IndexedDB metadata database records screen namespace, asset/binary identity,
  checksum metadata, MIME type, expected/final size, physical filename, priority, and LRU times.
- [x] Media keys include the screen namespace plus stable asset ID, binary ID, and binary version;
  URL freshness is never used as local identity.
- [x] Streamed OPFS writes use bounded chunks. Metadata becomes discoverable only after the file is
  closed and its final size matches the manifest, so interrupted pre-commit files are not playable.
- [x] Startup reconciliation removes missing/size-invalid metadata and orphaned writes without
  deleting another screen namespace.
- [x] Object URLs are stable per asset version for the browser session and support explicit leases;
  cleanup/reconciliation cannot revoke a URI owned by an active or prepared player slot.
- [x] LRU/age cleanup supports a protected set for active and candidate presentation binaries.
- [x] Startup requests `navigator.storage.persist()`, records `navigator.storage.estimate()` quota,
  and exposes `READY`, `DEGRADED`, or `UNAVAILABLE` in Player Controls and structured diagnostics.
- [x] Unpair, deletion, credential revocation, and clear-cache paths clear IndexedDB metadata, OPFS
  files, and the temporary Phase 0 Cache Storage so media cannot leak across device identity resets.
- [x] Target-device benchmark protocol and results sheet added at
  `docs/player-storage-benchmark.md`.
- [x] Changed-file lint, player TypeScript checking, and production player build pass.

Still required before Phase 3 is production-qualified:

- [ ] Run the 40 MB, 100 MB, 250 MB, 500 MB, and 1 GB benchmark on the lowest supported hardware
  tier and representative production devices.
- [ ] Measure startup, cold/warm seek, JavaScript and process memory, CPU, dropped frames, restart
  persistence, interrupted-write reconciliation, playlist loops, and storage pressure.
- [ ] Prove from network logs that local playback and later playlist loops request zero media bytes
  from the origin.
- [ ] Confirm OPFS `File` object URLs remain disk-backed on every supported Chromium/WebView build
  and do not cause full-file JavaScript heap growth during play or seek.
- [ ] If any supported browser lacks or fails OPFS, implement and qualify a fallback adapter behind
  the same interface. No silent fallback to the Phase 0 Service Worker cache is allowed.

Phase 3 now provides the persistent-storage boundary needed by the download manager. It does not
yet change live rendering to local URIs; doing that before atomic playlist activation would
reintroduce partial-state failures.

## 10. Create a Media Storage Abstraction

Do not put media-storage logic directly inside React components.

Create a dedicated abstraction.

Suggested location:

```text
apps/player/src/lib/media-storage/
```

Possible interface:

```ts
interface MediaStorage {
  exists(asset: AssetManifestItem): Promise<boolean>;

  getLocalUri(asset: AssetManifestItem): Promise<string | null>;

  writePartial(
    asset: AssetManifestItem,
    data: ReadableStream<Uint8Array>,
    options: PartialWriteOptions
  ): Promise<StoredPartial>;

  // Only the Phase 5 verifier may supply this evidence and expose a playable local URI.
  commitVerifiedPartial(
    asset: AssetManifestItem,
    evidence: VerifiedMediaEvidence
  ): Promise<string>;

  remove(assetId: string): Promise<void>;

  list(): Promise<StoredAsset[]>;

  getUsage(): Promise<StorageUsage>;

  cleanup(policy: CleanupPolicy): Promise<void>;

  // Requests durable browser storage where supported and reports whether it was granted.
  requestPersistence(): Promise<boolean>;
}
```

The playback layer should not care whether storage is implemented using:

- IndexedDB.
- Cache Storage.
- File System Access API.
- Flutter filesystem.
- Android application storage.

---

## 11. Web Player Storage

For the current Chromium web player, choose a persistent browser-supported storage mechanism. The
choice must be based on real target devices, not desktop development machines.

Recommended evaluation order:

### Option A — IndexedDB Blob Storage

Advantages:

- Good browser compatibility.
- Already conceptually aligned with the current player.
- Persistent.
- Structured metadata support.

Potential issue:

- Large video blobs require careful testing.
- Retrieval must not copy the complete Blob into JavaScript memory on every playback or seek.

### Option B — Cache Storage API

Advantages:

- Designed for request/response asset caching.
- Natural mapping to media URLs.

Potential issue:

- Storage eviction behavior must be verified.
- Cache Storage does not provide efficient random file access by itself. The current Workbox
  `createPartialResponse()` approach calls `response.blob()` for each range and is prohibited for
  production large-video playback.

### Option C — OPFS

Origin Private File System can provide stronger file-like behavior in modern Chromium environments.

It may become the preferred implementation for large media assets if supported reliably in the deployed player environment.

The preferred prototype is OPFS because it provides disk-backed file semantics suitable for large
media. The web implementation may expose an OPFS `File` through a short-lived object URL or a local
virtual media route, provided profiling proves that range/seek playback does not load the complete
file into JavaScript memory.

Do not assume the best option.

Run a prototype benchmark before selecting the final implementation.

The benchmark must run with 40 MB, 100 MB, 250 MB, 500 MB, and 1 GB files on the lowest supported
hardware tier and measure startup, seek time, memory, CPU, dropped frames, and restart persistence.
If OPFS is unavailable on a supported browser, the fallback adapter must pass the same tests.

On startup, call `navigator.storage.persist()` where supported and record the result. Use
`navigator.storage.estimate()` for quota telemetry. A denied persistence request must produce a
visible `DEGRADED` diagnostic state, not a false `READY` state.

## 11.1 Local URI Lifecycle

- Resolve local media before mounting the renderer.
- Reuse the same local URI for the same asset version.
- Revoke object URLs only after no active or prepared player slot references them.
- Never revoke and recreate a still-playing video's source during heartbeat/state refresh.
- Reconstruct local URIs after restart from persisted metadata without contacting the network.

---

## 12. Native Player Storage

For Flutter/native players, use real filesystem storage.

Example conceptual structure:

```text
Lumina/
  media/
    tenant-{tenantId}/
      {assetId}/
        {version}.mp4

  metadata/
    assets.json
    playlist.json
```

The native shell should expose local file URIs to the renderer.

---

# Phase 4 — Download Manager

## 4.0 Implementation Status — 2026-08-28

Implemented locally:

- [x] Dedicated `MediaDownloadManager` under `apps/player/src/lib/media-sync/`; React renderers do
  not contain download or persistent-file logic.
- [x] Manifest synchronization detects already stored binaries, fully downloaded staging files,
  missing files, changed binary versions, and superseded partial candidates.
- [x] One adjustable large-file queue defaults to one transfer; the lightweight image/audio/
  document queue defaults to two transfers. Files above 32 MB use the large queue regardless of
  MIME type.
- [x] Stable priority ordering processes `current`, `next`, `scheduled`, then `fallback` while
  preserving server manifest order inside the same priority.
- [x] One in-flight promise per screen/asset/binary/version. Concurrent synchronization callers
  join it instead of starting another request, and the application factory returns one manager per
  storage instance.
- [x] Randomized startup jitter is configurable and shared across the manager's queues.
- [x] OPFS `.part` staging and IndexedDB `DOWNLOADING`, `DOWNLOADED`, and `FAILED` metadata persist
  received byte count, expected size, validator, error, and update time across retries/restarts.
- [x] Safe Range resume requires an exact starting offset, total size, and unchanged ETag or
  Last-Modified validator. A missing or changed validator discards the partial instead of appending
  uncertain bytes.
- [x] The media API now forwards S3 `ETag` and `Last-Modified` and exposes Range/validator headers
  to the separate player origin through CORS.
- [x] Every response checks HTTP status, expected content length, content range when resuming, and
  MIME type before or during a bounded-memory streamed OPFS write.
- [x] Controlled attempts use immediate, 2 s, 5 s, 15 s, and 30 s delays, followed by a configurable
  five-minute background retry while the candidate remains desired.
- [x] Each attempt has connection, no-progress, and size-adjusted total timeouts. A task or
  superseded candidate can abort queued, waiting, fetching, or streaming work.
- [x] Explicit cancellation waits for the writer to settle and removes that asset's staged bytes;
  manifest supersession aborts obsolete tasks and discards obsolete partials but preserves stored
  versions that may still belong to the active presentation.
- [x] Progress subscriptions report pool, state, attempts, bytes, percent, retry time, and error;
  raw download-manager results deliberately report `ready: false`; the Phase 5 verified
  synchronizer is the only layer that may report playable readiness.
- [x] Download-manager requests carry versioned synchronization query markers, bypassing the
  temporary Phase 0 Service Worker media routes so one response is not duplicated into Cache
  Storage before being written to OPFS.
- [x] Focused tests cover stable priority, one-large-transfer concurrency, concurrent caller
  joining, successful exact-range resume, changed-validator discard, restart from byte zero, and
  newer-manifest supersession during an older preflight.
- [x] Five focused manager tests and all 37 existing API tests pass; player/API TypeScript checks,
  changed-file lint, and both production builds pass.

Still required before Phase 4 is production-qualified:

- [ ] Run interruption/resume tests against the real API, object storage, OPFS, and lowest-tier
  signage hardware rather than only the deterministic manager tests.
- [ ] Benchmark the one-large/two-light defaults and tune them only from target-device evidence.
- [ ] Run fleet publish/load tests with startup jitter and confirm aggregate API/object-storage
  concurrency remains within the production capacity budget.
- [ ] Confirm CDN/proxy layers preserve Range, ETag, Last-Modified, Content-Length, and
  Content-Range semantics exactly.

Phase 4 is complete and now runs only behind Phase 6's candidate/activation boundary. Production
qualification still depends on real interruption, fleet-load, and target-device evidence.

## 13. Create a Dedicated Download Manager

Suggested location:

```text
apps/player/src/lib/media-sync/
```

The download manager is responsible for:

- Detecting missing assets.
- Detecting changed assets.
- Downloading files.
- Resuming or retrying failed downloads.
- Validating downloaded files.
- Tracking progress.
- Controlling concurrency.
- Reporting readiness.
- Deduplicating concurrent requests for the same asset version.
- Cancelling superseded candidate downloads safely.
- Ensuring playback never starts an independent remote transfer.

Conceptual API:

```ts
interface MediaDownloadManager {
  synchronize(
    manifest: AssetManifestItem[]
  ): Promise<SyncResult>;

  cancel(assetId: string): Promise<void>;

  getProgress(): DownloadProgress[];
}
```

---

## 14. Download Concurrency

Do not download an unlimited number of videos simultaneously.

Start conservatively on signage hardware with:

```text
1 simultaneous large video download
```

and at most:

```text
2 simultaneous lightweight image/font/document-page downloads
```

Then benchmark.

Images can potentially use a higher concurrency limit than videos.

The configuration should remain adjustable.

Add randomized startup jitter so many screens receiving one publish event do not all begin large
downloads in the same millisecond. Fleet-level concurrency belongs in load testing even when each
individual player is correctly bounded.

## 14.1 Single-Owner Download Rule

Maintain one in-flight promise/task keyed by `tenantId + assetId + binaryVersion`. Every caller must
join that task. A renderer, preloader, state refresh, playlist zone, or Service Worker route must
never create a competing transfer.

The final architecture should not need the `<video>` element to contact `remoteUrl` at all. If a
temporary remote fallback is enabled during migration, it must be explicit, observable, and must
not run concurrently with the persistent full-file download.

---

## 15. Download Priority

Priority order:

1. Media required by the currently active playlist.
2. Media required by the next scheduled content.
3. Images and lightweight dependencies.
4. Background or future content.

Within the current playlist:

1. First playable asset.
2. Second asset.
3. Remaining assets.

This allows the screen to become ready as early as safely possible.

---

## 16. Temporary Files

Never mark a partially downloaded file as ready.

Use a temporary state:

```text
video_123.mp4.part
```

Only after successful validation:

```text
video_123.mp4
```

For IndexedDB implementations, use equivalent metadata states:

```text
DOWNLOADING
READY
FAILED
```

For OPFS/native filesystems, write to a version-specific `.part` path, flush/close it, validate
size and checksum, then atomically promote metadata to `READY`. File rename can be used where the
platform guarantees atomic rename; otherwise the metadata transaction is the commit point.

---

## 17. Retry Policy

Use controlled retries.

Example:

```text
Attempt 1 -> immediate
Attempt 2 -> 2 seconds
Attempt 3 -> 5 seconds
Attempt 4 -> 15 seconds
Attempt 5 -> 30 seconds
```

Then move to periodic background retry.

Do not create an aggressive retry loop.

Every attempt needs an `AbortController`/native cancellation token, connection timeout, no-progress
timeout, and total-attempt timeout appropriate to the expected file size. A slow but progressing
download must not be killed by a short total timeout; a connection transferring zero bytes must not
hang indefinitely.

For safe resume, persist the received byte count and require the server to confirm the same binary
version and total size before appending a new Range response. If any validator changes, discard the
partial and restart cleanly.

---

# Phase 5 — Asset Verification

## 5.0 Implementation Status — 2026-08-28

Implemented locally:

- [x] A dedicated `BrowserMediaAssetVerifier` is the only code path authorized to promote a staged
  OPFS file into playable asset metadata. The earlier direct-save path was removed so size-only
  writes cannot bypass verification.
- [x] SHA-256 is calculated incrementally from the OPFS `ReadableStream`; verification retains only
  the hash state and a 512-byte signature prefix, never the complete media in JavaScript memory.
- [x] Exact manifest size is checked against staging metadata and the bytes actually read before
  checksum comparison.
- [x] Known accepted image, video, and audio formats receive magic-byte/container-signature checks;
  unrecognized playable MIME types fail closed rather than silently becoming ready.
- [x] Image/document-page candidates must decode with non-zero dimensions. Video/audio candidates
  must load decoder metadata with a finite positive duration before promotion, with a bounded
  15-second probe timeout.
- [x] Readability probes use a temporary reference-counted URI for the staged OPFS `File` and
  release it before commit or deletion.
- [x] `commitVerifiedPartial()` requires matching checksum, MIME, byte size, readability, and
  verification time evidence. The IndexedDB transaction promotes the asset to `VERIFIED`, records
  `verifiedAt`, removes staging metadata, and clears an earlier failure atomically.
- [x] Startup reconciliation and `exists()` reject legacy records without `verificationStatus:
  VERIFIED`; those bytes are removed and must be downloaded and verified again.
- [x] A failed size, checksum, MIME, decoder, or storage check deletes only the invalid candidate,
  persists a version-specific `FAILED` record and attempt count, emits structured telemetry, and
  leaves any previous valid binary version untouched.
- [x] Concurrent requests for the same binary version join one verification promise. Candidate
  verification is serialized to reduce OPFS, CPU, and playback contention on signage hardware.
- [x] `BrowserVerifiedMediaSynchronizer` composes Phase 4 downloads with Phase 5 verification and
  returns `ready: true` only when every manifest binary is verified; `DOWNLOADED` is never treated
  as playable readiness.
- [x] Six focused verification tests cover standard/multi-block streaming SHA-256, successful
  promotion, checksum corruption, MIME corruption, decoder rejection, and all-assets readiness.
  All five Phase 4 download tests and player TypeScript checks also pass.

Still required before Phase 5 is production-active:

- [ ] Exercise valid and deliberately corrupted downloads against the real API, object storage,
  browser OPFS, and IndexedDB rather than only deterministic fakes.
- [ ] Qualify decoder probes for every accepted media format and target Chromium/WebView build,
  including unsupported-codec, zero-duration, truncated-tail, and image decode failures.
- [ ] Benchmark hash and decoder-probe wall time, CPU, process memory, and playback impact for 40 MB
  through 1 GB files on the lowest supported signage device.
- [ ] Confirm through an integration test that a failed new version never deletes or revokes the
  currently leased previous version.
- [ ] Connect structured verification failures to fleet telemetry/alerts and verify Phase 6's
  periodic synchronization retries a failed version later without a tight loop.

Phase 5 is complete and is now the mandatory verification gate used by Phase 6 activation.

## 18. Validate Every Download

A file should only become usable after validation.

Validation options:

- Expected file size.
- MIME type.
- HTTP status.
- Checksum.
- Basic media readability.

Preferred flow:

```text
Download
   |
   v
Expected size correct?
   |
   v
Checksum correct?
   |
   v
Mark READY
```

---

## 19. Corrupted Asset Handling

If an asset fails validation:

- Delete the invalid local copy.
- Mark the asset as `FAILED`.
- Keep the previous valid asset version if available.
- Retry later.
- Report telemetry.

The player must not attempt to play a known corrupt file.

---

# Phase 6 — Atomic Playlist Activation

## 6.0 Implementation Status — 2026-08-28

Implemented locally:

- [x] `PlayerPage` now requests `/player/manifest`; `/player/state` and its remote-URL cache are no
  longer allowed to replace the running presentation directly.
- [x] `BrowserPresentationActivationCoordinator` maintains `DOWNLOADING`, `READY`, `ACTIVE`,
  `FAILED`, and `SUPERSEDED` boundaries. A changed manifest is a candidate until every later gate
  succeeds, while an unchanged `contentRevision` preserves the current React tree and media URLs.
- [x] Phase 4 download staging and Phase 5 verification are composed before candidate preparation;
  `DOWNLOADED` or partially verified results cannot activate.
- [x] Candidate preparation acquires one reference-counted final OPFS lease for every manifest
  binary. Any missing lease releases all already acquired candidate leases and fails closed.
- [x] Plain assets, document pages, nested playlists, themes, layouts, designs/backgrounds/posters,
  wayfinding floor plans, POI icons, and attract content are cloned and rewritten to local object
  URLs. A closure check rejects the candidate if any manifest media URL remains remote.
- [x] Document page identities must be unique, contiguous, and ordered. Duplicate primary binaries,
  duplicate storage keys, and incomplete page sets fail candidate preparation.
- [x] Every candidate video repeats a device decoder/metadata/duration readiness probe against its
  final leased URI before the candidate reaches `READY`.
- [x] IndexedDB schema version 4 stores the source snapshot, `contentRevision`, manifest asset
  metadata, complete asset-version key set, and activation time. One transaction revalidates every
  `VERIFIED` asset record and commits the active snapshot before React receives it.
- [x] Startup restores the last committed source snapshot, reacquires fresh OPFS object URLs, checks
  its exact asset-key set, and can display it before the first network manifest request completes.
- [x] React publishes the local state and resolved playlist in one batched update. The previous
  presentation's URI leases are released only after the replacement DOM commit, so a failed or
  incomplete candidate never revokes the playing presentation.
- [x] First-time screens show an intentional synchronization state instead of streaming an
  incomplete remote playlist. Manifest failures retain the current presentation and retry on the
  next periodic refresh, publish command, or socket reconnect.
- [x] The earlier next-item `fetch()` cache warmer was removed. Active image/video renderers now
  receive only local OPFS URLs, preventing a second remote owner beside the download manager.
- [x] Eight focused Phase 6 tests cover local candidate construction, document ordering, failed-lease
  cleanup, nested theme/layout/design/wayfinding rewriting, commit-before-ACTIVE ordering,
  unchanged-revision stability, supersession, failed-candidate rollback, and persisted restoration.

Still required before Phase 6 is production-qualified:

- [ ] Run browser-level tests with real IndexedDB and OPFS that terminate the process before and
  after the activation transaction and prove restart selects only the last committed snapshot.
- [ ] Publish broken and superseding candidates while a previous multi-video playlist is playing;
  prove the old decoder, URI leases, and playlist index remain healthy until the successful switch.
- [ ] Disconnect networking after synchronization and verify repeated playlist loops, schedule
  changes, wayfinding navigation, and process restarts request zero local-media bytes remotely.
- [ ] Test first-install synchronization, interrupted downloads, storage pressure, corrupt files,
  unsupported codecs, and recovery on the lowest supported signage hardware.
- [ ] Measure activation probe time and switch latency for large manifests, then connect activation
  state/failure telemetry to fleet monitoring.
- [ ] Deploy the Phase 2 database migration/backfill and the compatible API/worker/player versions
  in the required order before enabling this player build in production.

Phase 6 is complete locally and is now wired into live PlayerPage ownership. Phase 7 should prove
and harden offline behavior rather than reintroducing remote playback fallbacks.

## 20. Separate Playlist Download from Playlist Activation

This is one of the most important changes.

Receiving a playlist must not immediately replace the currently running playlist.

Instead:

```text
SERVER PLAYLIST
      |
      v
Candidate Playlist
      |
      v
Check required assets
      |
      v
Download missing assets
      |
      v
Verify all required assets
      |
      v
READY
      |
      v
Activate Playlist
```

---

## 21. Player Playlist States

Suggested states:

```text
ACTIVE
DOWNLOADING
READY
FAILED
SUPERSEDED
```

Example:

```text
Playlist A = ACTIVE

Playlist B arrives
Playlist B = DOWNLOADING

Player continues Playlist A.

Playlist B assets complete
Playlist B = READY

Atomic switch:

Playlist B = ACTIVE
Playlist A = PREVIOUS
```

Persist the active snapshot, its `contentRevision`, and the complete set of READY asset-version
keys in one local database transaction. Only after that transaction commits may React/Flutter
receive the new active state. A process crash between download completion and commit must restart
with Playlist A active, not a half-written Playlist B.

Activation also requires a playback-readiness probe for every required video: the file exists,
metadata can be loaded, duration is finite/non-zero, and the browser/native decoder accepts the
normalized codec. Integrity alone proves the bytes match; it does not prove the device can decode
them.

---

## 22. Never Break the Current Screen

If the candidate playlist cannot be downloaded:

```text
DO NOT activate it.
```

The currently working playlist must continue playing.

This prevents screens from becoming blank because of:

- Poor connectivity.
- Server downtime.
- Partial media upload.
- Broken asset URL.
- Corrupted video.
- Storage failure.

For a first-time screen with no previous playlist, show an intentional synchronization screen with
progress. Do not stream an incomplete candidate behind that screen. Once the first required set is
READY, activation happens once and normal playback starts locally.

---

# Phase 7 — Offline Playback

## 7.0 Implementation Status — 2026-08-28

Implemented locally:

- [x] A shared browser connectivity monitor exposes `ONLINE`, `OFFLINE`, `CHECKING`, and
  `DEGRADED`. Browser link events provide an immediate signal while successful/failed Lumina API
  calls distinguish real server reachability from `navigator.onLine` alone.
- [x] Startup initializes persistent storage and restores the last atomically committed local
  presentation before the first manifest request. A known-offline boot skips manifest and socket
  connection attempts, marks loading complete, and starts the restored playlist immediately.
- [x] Manifest fetches have a 15-second request bound. The bound ends as soon as the manifest is
  received and never cancels the subsequent download/verification/activation transaction. An API
  timeout or outage preserves the active local presentation and retries later.
- [x] Heartbeat, periodic manifest refresh, widget refresh, kiosk analytics, and socket connection
  attempts are suppressed while connectivity is definitively `OFFLINE`. The socket is explicitly
  disconnected when the browser loses its link instead of running a background reconnect loop.
- [x] Browser and socket recovery share one deduplicated sequence: heartbeat first, then manifest
  fetch/comparison, changed-asset synchronization, and Phase 6 atomic activation. The currently
  rendered presentation and its media leases remain active throughout synchronization.
- [x] Weather, currency, and RSS ticker widgets restore their last IndexedDB value, retain it on
  request failure, avoid refresh attempts offline, and refresh immediately when connectivity
  returns. Static widgets, packaged fonts, schedules, and prayer-time calculation require no
  network during normal playback.
- [x] YouTube `APP` assets are treated as an explicit network-required exception. Offline players
  show a clear unavailable message instead of waiting forever; the IFrame API loader now has error
  and timeout handling and retries after a later browser reconnect.
- [x] Browser candidate preparation rejects every media lease that is not a `blob:` URI. Combined
  with manifest dependency closure and state rewriting, this prevents a storage or renderer path
  from silently falling back to remote video/image/document URLs during offline playback.
- [x] Player Controls now shows connection state, browser link state, explanatory fallback text,
  and last successful server contact. The same state is exposed as
  `data-connectivity-state` on the document root for local inspection.
- [x] Six focused Phase 7 tests cover offline boot policy, reconnect state, degraded API behavior,
  listener lifecycle, required heartbeat-before-manifest ordering, and a link loss between those
  steps. The Phase 6 suite also proves that non-local leases fail activation and are released.

Still required before Phase 7 is production-qualified:

- [ ] On every supported browser/WebView and the lowest-tier signage device, synchronize a real
  multi-video playlist, disable all networking, restart the player/device, and prove playback
  begins from the committed snapshot without a server wait.
- [ ] Capture DevTools/proxy traffic across repeated playlist loops, schedule transitions,
  wayfinding navigation, and process restarts. There must be zero remote requests for active
  video, image, document-page, or packaged-font bytes.
- [ ] Run an extended offline soak with large videos and multiple complete playlist loops; record
  decoder stalls, dropped frames, memory, object-URL lease counts, OPFS reads, and unexpected
  network attempts. Phase 9 remains responsible for seamless next-video warm-up/transition work.
- [ ] Verify online recovery against actual API/socket outages, interrupted downloads, a manifest
  published while offline, and connectivity flapping. Playback must stay on the old revision until
  the new one is fully verified and atomically active.
- [ ] Decide whether configurable prayer-call audio is a packaged resource or a normal manifest
  asset and bring it under the same verified local dependency contract. External app content must
  remain explicitly labeled `networkRequired`.
- [ ] Confirm the PWA shell, packaged fonts, widget cache age/presentation, connection diagnostics,
  and 15-second manifest bound on production kiosk builds, then connect connectivity transitions
  and prolonged degraded/offline state to fleet telemetry.

Phase 7 is complete locally. This establishes offline policy and recovery behavior; it does not
claim the decoder-level seamless transitions planned in Phases 8–10, and it is not production-
qualified until the real-device zero-network and restart evidence above is attached.

## 23. Define Offline-First Behavior

After successful synchronization:

```text
Internet OFF
```

must not stop normal playback.

The player should continue using:

- Local playlist.
- Local videos.
- Local images.
- Local fonts where required.
- Local widget fallback data where appropriate.

---

## 24. Startup Without Internet

On player startup:

```text
Try network sync
      |
      +-------- online --------> normal sync
      |
      +-------- offline -------> load last valid local playlist
```

If a valid local playlist exists:

```text
START PLAYBACK IMMEDIATELY
```

Do not wait indefinitely for the server.

---

## 25. Reconnection

When connectivity returns:

```text
Reconnect
   |
   v
Heartbeat
   |
   v
Fetch latest playlist
   |
   v
Compare manifest
   |
   v
Download changes
   |
   v
Atomic activation
```

Playback should continue during the synchronization process.

---

# Phase 8 — Playback Resolver

## 8.0 Implementation Status — 2026-08-28

Implemented locally:

- [x] The whole `desiredState` tree — playlist items, nested theme/layout/design elements,
  document pages, and wayfinding floors/POIs — is resolved to local `blob:` URIs once at
  activation time (`presentation-preparer.ts` → `rewritePlayerStateToLocalUris`), not per-render.
  `ZonePlayer` renders `asset.url`/`pageUrls` unchanged and gets local URIs for free.
- [x] `assertNoRemoteAssetUrls` walks the fully rewritten state and throws if any remote URL
  string survives, making "never render a remote URL" an activation invariant rather than
  something every renderer has to remember independently.
- [x] `acquireLocalUri()` leases are rejected outright if they aren't `blob:` — this is the
  `remoteFallback: false` production default from §26 implemented as a hard failure, not a
  configurable option that could silently drift.
- [x] 8/8 `test:presentation` tests cover local-URI rewriting (including nested themes/layouts/
  designs/wayfinding), duplicate/missing-binary rejection, and refusing a non-local lease.

Not implemented (§27's priority list, items 2–3):

- [ ] "Valid local previous asset version" as an explicit fallback tier — today there is exactly
  one persisted `StoredActivePresentation` per namespace; an old version's files may still be
  physically present until cleanup runs, but nothing selects them as a deliberate fallback if
  the current candidate fails. In practice this doesn't currently cause blank screens because
  activation only ever replaces the current presentation after a *new* candidate fully succeeds
  (Phase 6) — but it means there is no path back to "the version before last" if the immediately
  active one somehow becomes unplayable after activation.
- [ ] Configurable remote-fallback toggle — intentionally not built; §26 already settled on
  always-local as the production default.

Phase 8 is complete for the production default (local-only, no remote fallback).

## 26. Resolve Local Media Before Rendering

`ZonePlayer` should no longer blindly render:

```tsx
<video src={asset.url} />
```

The rendering layer should receive a resolved playback source.

Conceptually:

```ts
const source = await mediaResolver.resolve(asset);
```

Possible result:

```ts
{
  sourceType: "local",
  uri: "blob:..."
}
```

or native:

```ts
{
  sourceType: "local",
  uri: "file:///..."
}
```

Remote playback should only be used as a deliberate fallback.

The production default is `remoteFallback: false`. A valid active local playlist is safer than
switching to a desired playlist that can only stream. If remote fallback is temporarily enabled,
the dashboard and heartbeat must report `DEGRADED_REMOTE_PLAYBACK`.

---

## 27. Playback Source Priority

Recommended priority:

```text
1. Valid local current asset
2. Valid local previous asset version
3. Remote URL fallback, only if explicitly allowed
4. Placeholder / safe fallback
```

For production signage, remote streaming fallback should be configurable.

Some installations may prefer:

```text
Never stream remotely.
```

Instead they should keep the previous playlist.

---

# Phase 9 — Transition and Preload Logic

## 9.0 Implementation Status — 2026-08-28

Implemented locally:

- [x] §28's local-source requirement — inherited for free from Phase 8: the active `<video>`
  always renders an already-resolved local `blob:` URI, never a network fetch.
- [x] §29.3's playback progress watchdog — `VIDEO_START_TIMEOUT_MS`/`VIDEO_STALL_TIMEOUT_MS`
  polling, bounded local reload recovery (`MAX_LOCAL_VIDEO_RECOVERIES`), then advance-past or a
  "Media unavailable" fallback for a single-item playlist. Matches §29.3 steps 1–4.
- [x] §29.2's single-video-playlist native loop (`loop={playlist.items.length === 1}`, no
  `onEnded` remount) and unchanged-`contentRevision` stability (video identity is keyed on
  `item.id` + resolved URL, not on the whole refetched state object, so a same-video heartbeat
  refresh never remounts or restarts it — this was a real prior incident, see the decoder-release
  effect's comment).
- [x] §28/§29.1's constrained-hardware tier only — added 2026-08-28: a hidden, non-playing
  `<video preload="auto" muted>` warms the *next* playlist item's local blob ahead of the
  transition (browser blob-read path only; never a second live decoder). Purely additive next to
  the existing single-slot playback path, so it cannot regress the watchdog/recovery behavior
  above if it fails to warm anything.

Not implemented:

- [ ] §29.1's full "Slot A/B" prepared-next-video swap — today the visible `<video>` element still
  fully unmounts and remounts at every transition (a fresh mount, not an instant slot swap), so
  there is still a real decode-to-first-frame cost and a black-flash gap on every video-to-video
  transition in a multi-item playlist. The hidden preload element above only warms local disk
  reads; it does not eliminate this. This is the most likely remaining source of visible "stutter"
  at playlist transitions now that Phase 1–8 has removed the network-download stutter that
  originally motivated this whole repair.
- [ ] Crossfade vs. frame-held-cut, and single-/dual-decoder device tiering — needs a device
  capability/profiling mechanism this codebase does not yet have; explicitly deferred rather than
  guessed at.
- [ ] No automated test coverage for `ZonePlayer.tsx`'s video lifecycle — verification here was
  typecheck/lint plus manual reasoning through the existing effects, not an in-browser test; the
  file has no test harness today.

## 28. Preserve Existing Video Preload Behavior

Preserve the intent of next-video preloading, but replace the current network `fetch(next.url)`
implementation. The playback engine should prepare the **local source** only after the asset is
READY.

Example:

```text
Current video:
file:///local/video-A.mp4

Next preload:
file:///local/video-B.mp4
```

This improves transition smoothness without creating network dependency.

---

## 29. Video Warm-Up

Before transitioning to the next video:

- Resolve local URI.
- Create video element.
- Load metadata.
- Confirm readiness.
- Transition at the correct time.

Avoid unnecessary full-memory loading of large video files.

## 29.1 Prepared Two-Slot Playback

For a playlist containing multiple videos, use two logical player slots:

```text
Slot A = visible/current
Slot B = hidden/prepared next
```

Preparation sequence:

1. Resolve the next item's local URI.
2. Assign it to the inactive slot.
3. Load metadata and seek to the configured start position.
4. Wait for a bounded readiness condition (`loadeddata`/`canplay` plus successful decode of the
   first frame where the platform exposes that signal).
5. At transition, reveal the prepared slot and retire the old slot.
6. Release the old decoder promptly, then prepare the following item.

Do not keep more decoder-backed video elements alive than the target device supports. The engine
must expose a configurable single-decoder mode for constrained TVs/WebViews: prepare the next local
file and metadata without holding a second active hardware decoder, release the current decoder at
the boundary, then start the next. Device profiling decides the default per supported hardware
tier.

Crossfade is allowed only on hardware proven to sustain two concurrent decoders. Otherwise use a
frame-held cut: keep the final frame/poster visible while the next local video starts, preventing a
black flash without exceeding decoder capacity.

## 29.2 Playlist Timing Rules

- A video marked `playFullVideo` advances on `ended`, guarded by the progress watchdog.
- A duration-limited video advances at the configured duration, but only after the following item
  is prepared; if it is not ready locally, keep the current valid frame/content and report degraded
  readiness rather than opening a network stream.
- A single-video playlist uses native/local looping without remounting or recreating its URI.
- Repeated occurrences of the same asset version reuse one stored file and one stable resolved URI.
- Heartbeat/state refreshes with an unchanged `contentRevision` must not reset playback timers,
  remount video elements, call `load()`, or restart preparation.

## 29.3 Playback Progress Watchdog

Track `currentTime`, `readyState`, media events, and wall-clock time. While playback is expected:

1. If no progress occurs for a configurable threshold, attempt one local `play()` recovery.
2. If still stuck, release and recreate that slot from the same verified local file.
3. If the retry also fails, mark the asset playback failure, report telemetry, and advance safely
   to the next READY item.
4. If no next item is playable, keep the previous valid visual/fallback instead of a black screen.

Recovery must be bounded to prevent an infinite reload loop around a permanently unsupported file.

---

# Phase 9A — Media Normalization for Predictable Playback

## 9A.0 Implementation Status — 2026-08-28

Confirmed live in production, not theoretical: the player console showed the *same* video
(`itemId cmtb3txgf...`, `assetId cmtao8vcx...`) firing repeated native `playing` events at
`generation: 0` — i.e. the browser repeatedly pausing/resuming *mid-playback* of an already-local
blob, not a transition or caching issue. The asset's source filename
(`16912651-uhd_3840_2160_60fps.mp4`) and DB row confirmed why: `worker/media.processor.ts`'s
transcode capped resolution (`scale='min(1920,iw)':-2`) but never capped frame rate, so a 60fps
source was re-encoded at 1080p **60fps** — exactly the "4K/high-bitrate master sent to a low-cost
decoder" failure this phase already predicted, just manifesting as frame rate rather than
resolution.

Implemented locally:

- [x] Transcode now adds `fps=30` to the scale filter, plus `-maxrate 8M -bufsize 16M` to bound
  worst-case bitrate for high-motion footage that CRF 23 alone doesn't cap. Applies to every video
  processed from here on.

Not implemented / explicitly out of scope for this pass:

- [ ] **Existing already-transcoded assets are unaffected** — this asset and any other 60fps
  upload processed before today will keep stuttering until reprocessed. The existing
  `POST /assets/:id/reprocess` endpoint only accepts assets in `ERROR` status ("Only a failed
  asset can be reprocessed"); there is no way to force a `READY` asset through the pipeline again
  today. Immediate workaround: re-upload the affected video as a new asset. A proper "reprocess a
  READY asset" admin action is a reasonably-sized follow-up, not attempted here blind.
- [ ] No documented profile/level pin, and 30fps/8Mbps are reasonable defaults, not numbers taken
  from §29.5's required lowest-tier hardware corpus test — that corpus/test still needs to happen.

Local storage cannot make an unsupported codec or excessive bitrate smooth. Every uploaded video
must be normalized by the worker before it becomes manifest-eligible.

## 29.4 Required Baseline Rendition

Initial broadly compatible profile:

- MP4 container with `faststart`.
- H.264/AVC video, `yuv420p` pixel format, documented profile and level compatible with the oldest
  supported device.
- AAC-LC audio with a standard sample rate/channel layout.
- Maximum dimensions appropriate to orientation: 1920×1080 landscape or 1080×1920 portrait.
- Bounded frame rate and bitrate selected from actual lowest-tier hardware tests.
- Regular keyframes suitable for startup, seeking, and duration-limited playback.
- No malformed or zero-duration output.

The worker must probe the final output, not the upload, and persist final size, checksum, duration,
dimensions, codecs, frame rate, and bitrate. The asset becomes `READY` only after this probe passes.

If one baseline rendition cannot cover all hardware tiers, the manifest may select a rendition by
player capability. Do not send a 4K/high-bitrate master to a low-cost 1080p decoder and call the
result a caching problem.

## 29.5 Normalization Acceptance

Build a corpus containing phone recordings, variable-frame-rate input, 4K input, portrait video,
videos with and without audio, long GOP input, and unusual source containers. Every accepted item
must produce the baseline rendition and pass local playback on the lowest supported device. Failed
normalization must produce a clear asset error before publication.

---

# Phase 10 — Storage Lifecycle

## 10.0 Implementation Status — 2026-08-28

Implemented locally:

- [x] `MediaStorage.cleanup(policy)` — LRU/age eviction with a protected `retainStorageKeys` set,
  already built as part of Phase 3.
- [x] Wired into `PlayerPage.tsx` (it previously existed but nothing ever called it): runs after
  every successful activation, retaining only the just-published presentation's storage keys, plus
  every 30 minutes as a backstop. `maxUnusedMs` defaults to 7 days (§32's suggested previous-
  playlist retention); `maxMediaBytes` targets 80% of `navigator.storage.estimate()`'s quota when
  the browser reports one (§33's warning threshold), otherwise cleanup runs on age alone.
- [x] Retention is read from a live ref updated on every activation, not a stale snapshot — a slow
  or failed cleanup call can never evict what's actively on screen.

Not implemented:

- [ ] §33's explicit Warning(80%)/Critical(90%) two-tier response — today there is one threshold
  (80%, used as the eviction target) rather than a distinct 90% "stop prefetch, preserve only
  active+previous" critical mode.
- [ ] No production-scale test yet against a real multi-GB local store on signage hardware.

## 30. Prevent Unlimited Disk Growth

A persistent media cache needs lifecycle management.

The player must periodically remove assets that are no longer needed.

Never simply delete everything after every playlist update.

---

## 31. Protected Assets

Do not delete assets required by:

- Current active playlist.
- Candidate playlist currently downloading.
- Previous fallback playlist.
- Content scheduled in the near future.

---

## 32. Cleanup Policy

Suggested cleanup strategy:

```text
Keep:
- Active playlist assets
- Candidate playlist assets
- Previous valid playlist assets
- Recently used assets

Remove:
- Orphaned assets
- Superseded versions
- Failed partial downloads
- Assets unused for configurable period
```

Possible retention:

```text
Previous playlist retention: 7 days
```

Make this configurable.

Cleanup timestamps must come from the local metadata database (`downloadedAt`/`lastUsedAt`), not
from optional cross-origin HTTP headers. A missing header must never make a new asset appear old.

Run cleanup against bytes and protected references, not only an entry count. Before deletion,
recompute the protected asset-version set from ACTIVE, CANDIDATE, PREVIOUS, emergency/fallback, and
look-ahead scheduled content. Record an eviction reason for telemetry and diagnostics.

---

## 33. Storage Thresholds

Track:

- Available storage.
- Used storage.
- Media cache size.
- Temporary download size.

Recommended thresholds:

```text
Warning: 80%
Critical: 90%
```

At critical storage:

- Run cleanup.
- Stop unnecessary prefetch.
- Preserve active playlist.
- Preserve previous fallback.
- Report telemetry.

If the candidate cannot fit after safe cleanup, reject that candidate with `INSUFFICIENT_STORAGE`
and keep the active playlist. Never delete active assets to make room for desired content.

---

# Phase 11 — Media Metadata Database

## 34. Maintain Local Asset Metadata

Suggested record:

```ts
interface StoredAsset {
  assetId: string;

  version: string;
  checksum?: string;

  mimeType: string;

  localUri: string;

  fileSize: number;

  status:
    | "DOWNLOADING"
    | "READY"
    | "FAILED";

  downloadedAt: string;
  lastUsedAt: string;

  verifiedAt: string;
  failureCode?: string;
}
```

The metadata store should be separate from the actual binary storage implementation.

Metadata updates and playlist activation must use transactions. On startup, reconcile metadata
against actual files: delete orphan `.part` files, downgrade missing READY records, and quarantine
unexpected files rather than assuming either store is perfect.

---

# Phase 12 — Player Status and Telemetry

## 12.0 Implementation Status — 2026-08-28

Implemented locally:

- [x] `Screen` model extended with a `SyncState` enum (`UNKNOWN`/`SYNCING`/`READY`/`DEGRADED`/
  `FAILED`, distinct from the existing `ScreenStatus` ONLINE/OFFLINE) plus `assetsTotal`,
  `assetsReady`, `assetsDownloading`, `assetsFailed`, `cacheBytes`, `freeStorageBytes`,
  `storagePersistent`, `lastSuccessfulSyncAt` — migration
  `20260828120000_add_screen_sync_telemetry`, **not yet applied to the running database** (see
  guardrail §53 — this must not ship enabled without being applied first).
- [x] `POST /player/heartbeat` accepts all of the above as independently optional fields (an
  older player build sending only `currentAssetId`/`hasContent` still works unchanged) and
  persists whichever ones a given heartbeat actually included.
- [x] The player computes and sends them every heartbeat: `syncState` from the activation
  coordinator's own status (`ACTIVE`→`READY`, `DOWNLOADING`/`READY`/`SUPERSEDED`→`SYNCING`,
  `FAILED`→`DEGRADED` if there's still valid local content or `FAILED` if there never was any);
  `assetsReady`/`assetsFailed` matched against the last-fetched manifest's expected storage keys
  (not a raw local-store count, so a stale file from a since-changed playlist isn't counted);
  `assetsDownloading` derived as `total - ready - failed`; `cacheBytes`/`freeStorageBytes`/
  `storagePersistent` from `MediaStorage.getUsage()`; `lastSuccessfulSyncAt` set only on a
  heartbeat immediately after a sync check actually succeeded.
- [x] Typecheck, lint, and the full player + manifest test suites (25 + 8) still pass.

Not implemented — deferred, not attempted blind:

- [ ] `currentAssetId` already existed pre-Phase-12; `playbackState`, `playbackRecoveryCount`,
  `droppedFrameCount`, and `remoteMediaRequestCount` do not. These live at the `ZonePlayer`
  level (recovery attempts, `video.getVideoPlaybackQuality()` dropped frames, APP-type network
  dependency count) and would need a new callback path out of `ZonePlayer` up to `PlayerPage`,
  which touches the same carefully-tuned effect graph as Phase 9 — scoped out of this pass rather
  than rushed alongside it.
- [ ] §36's admin-facing `ONLINE/OFFLINE/SYNCING/READY/DEGRADED/ERROR` display and the
  `DOWNLOAD_TIMEOUT`/`CHECKSUM_MISMATCH`/etc. error-code vocabulary — the doc itself marks this
  "not required for the first implementation milestone," and no dashboard UI reads the new fields
  yet. The architecture supports it (the columns exist); building the UI is a separate task.

## 35. Extend Heartbeat Information

The server should know whether the player has synchronized successfully.

Recommended heartbeat fields:

```ts
{
  playlistId,
  playlistVersion,

  syncState,

  assetsTotal,
  assetsReady,
  assetsDownloading,
  assetsFailed,

  cacheBytes,

  freeStorageBytes,

  online,

  lastSuccessfulSyncAt

  currentAssetId,
  playbackState,
  playbackRecoveryCount,
  droppedFrameCount,
  remoteMediaRequestCount,
  storagePersistent
}
```

`READY` means the active revision is committed and all required local assets are verified and
playback-probed. Being online or having fetched JSON is not sufficient.

---

## 36. Operational Status

Admin UI should eventually distinguish:

```text
ONLINE
OFFLINE
SYNCING
READY
DEGRADED
ERROR
```

Useful error codes include `DOWNLOAD_TIMEOUT`, `CHECKSUM_MISMATCH`, `QUOTA_EXCEEDED`,
`UNSUPPORTED_CODEC`, `LOCAL_FILE_MISSING`, `DECODER_STALLED`, and
`DEGRADED_REMOTE_PLAYBACK`.

Example:

```text
Screen 14

Status: ONLINE
Playlist: v27
Assets: 18 / 18 ready
Storage: 3.2 GB / 16 GB
Last sync: 34 seconds ago
```

This is not required for the first implementation milestone, but the player architecture should support it.

---

# Phase 13 — Error Handling

## 13.0 Implementation Status — 2026-08-28

Checked against each §37 scenario (not just asserted):

Covered, with the module responsible:

- [x] Server unreachable / playlist endpoint failure → `connectivity.ts` suppresses network work
  and `refreshPresentation`'s catch keeps the active local presentation untouched (Phase 7).
- [x] Asset download timeout, connection interruption, partial download → `media-sync`'s bounded
  retry/backoff and Range-resume, tested (`test:media-sync`, 5/5).
- [x] HTTP 404/500 asset, corrupt file → verification rejects and quarantines as `FAILED` without
  touching the previous valid version, tested (`test:media-verify`, 6/6).
- [x] Player restart during download / while offline → startup reconciliation removes orphaned
  writes; `coordinator.restore()` boots from the last local presentation before any network call
  (Phase 14 below).
- [x] Playlist changed / asset replaced during download, duplicate asset across playlists →
  generation-based supersede logic and `binaryVersion`-keyed identity, tested
  (`test:presentation`: "a newer manifest supersedes..."; `test:media-sync`: "discards a changed
  validator...").
- [x] Decoder accepts metadata but produces no progress → `ZonePlayer`'s stall watchdog
  (`VIDEO_STALL_TIMEOUT_MS`, tracked via `onTimeUpdate`).

Checked and found to be gaps, not yet handled:

- [ ] Storage quota full mid-write — `opfs-media-storage.ts` only reads
  `navigator.storage.estimate()` for reporting; there is no explicit `QuotaExceededError` catch on
  a write that hits the real browser/OS limit. It would presumably surface as a generic write
  failure and get retried like any other, rather than deliberately triggering cleanup first — Phase
  10's cleanup (now wired, see its status) reduces how often this is hit but doesn't close the gap.
- [ ] Browser storage eviction *during* an active session (not just detected at the next restart's
  reconciliation) — there's no listener for this; a mid-session eviction wouldn't be noticed until
  the next playback attempt on the now-missing file fails.
- [ ] Service Worker update during synchronization — `sw.ts` calls `skipWaiting()`
  unconditionally, with no check for an in-flight sync. Media downloads go through the page's own
  OPFS-writing download manager rather than SW-intercepted fetches, so this is lower-risk than it
  sounds, but it hasn't been verified either way.
- [ ] Single-hardware-decoder devices — same gap as Phase 9's missing device tiering.

Not independently re-verified this pass (already covered by other phases' own status sections):
several screens synchronizing the same publish event simultaneously (ordinary per-screen API load,
no shared state to race on).

## 37. Required Failure Scenarios

The repaired player must handle:

- Server unreachable.
- Playlist endpoint failure.
- Asset download timeout.
- HTTP 404 asset.
- HTTP 500 asset.
- Connection interruption.
- Partial download.
- Corrupt file.
- Storage quota full.
- Player restart during download.
- Player restart while offline.
- Playlist changed during download.
- Asset replaced while downloading.
- Duplicate asset across playlists.
- Decoder accepts metadata but produces no playback progress.
- Browser storage eviction after a previously successful sync.
- Service Worker update during synchronization.
- Device with only one hardware video decoder.
- Several screens synchronizing the same publish event simultaneously.

---

## 38. No Blank Screen Rule

A core reliability requirement:

> A synchronization failure must never turn a previously functioning screen into a blank screen.

Fallback order:

```text
Current valid playlist
        |
        v
Previous valid playlist
        |
        v
Configured fallback content
```

For a multi-item playlist, one locally corrupt/undecodable item may be skipped after bounded
recovery while the remaining READY items continue. Report the failure and do not retry it on every
loop. A replacement version or explicit maintenance action may clear the quarantine.

---

# Phase 14 — Player Restart Recovery

## 14.0 Implementation Status — 2026-08-28

Implemented locally:

- [x] §39 steps 1–4 — `coordinator.restore()` loads the persisted `StoredActivePresentation`,
  rebuilds fresh local leases from it, and `PlayerPage.tsx` publishes it immediately, before
  `refreshPresentation`'s network call ever runs. Tested (`test:presentation`: "restores a
  persisted source snapshot by rebuilding fresh local leases").
- [x] §39 step 5/6 — contacting the server and resuming synchronization happens after the local
  boot (`await refreshPresentation(coordinator)` runs only after `setLoaded(true)`), never blocking
  first paint on network.
- [x] §40 — the backend genuinely supports `Range` requests end-to-end
  (`storage.service.ts`: `Accept-Ranges`/`Content-Range`/206), and the download manager resumes
  only from a matching validator + exact byte range, discarding and restarting from zero if the
  validator changed underneath it — tested (`test:media-sync`).
- [x] "A restart must not force all media to download again" — verified media stays `READY` across
  restarts; only missing/invalid entries get re-fetched.

Phase 14 is complete and tested; no gaps found for this phase specifically.

## 39. Resume State After Restart

On startup:

1. Load local metadata.
2. Identify active playlist.
3. Verify required local assets.
4. Start playback immediately when valid.
5. Resume incomplete synchronization.
6. Contact server in the background.

A restart must not force all media to download again.

---

## 40. Interrupted Downloads

Incomplete downloads should either:

- Resume safely if the backend supports Range requests.

or:

- Restart cleanly.

Do not treat partial files as complete.

---

# Phase 15 — Testing

## 15.0 Implementation Status — 2026-08-28

Implemented locally:

- [x] The existing deterministic suites map to the required unit behaviors: six offline/
  connectivity tests, five download-manager tests, six verification tests, and eight presentation
  tests cover version identity, resolver rewriting, retry/Range behavior, state transitions,
  checksum/MIME/readability rejection, activation rollback, supersession, and persisted restart.
- [x] A new composed integration suite uses the real `BrowserMediaDownloadManager`,
  `BrowserMediaAssetVerifier`, `BrowserVerifiedMediaSynchronizer`,
  `BrowserPresentationPreparer`, and `BrowserPresentationActivationCoordinator` rather than mocked
  stage results. It proves manifest media downloads exactly once with `cache: no-store`, verifies,
  activates only a local `blob:` source, persists, and restores offline without another transfer.
- [x] The second composed scenario proves a disconnected candidate remains inactive while the
  baseline revision stays committed, then resumes with `Range: bytes=8-`, completes verification,
  and atomically activates the new revision. These two tests run via `pnpm --filter player
  test:integration`.
- [x] OPFS cleanup decisions are now isolated in a pure LRU/age planner used by the real adapter.
  Three tests prove least-recently-used quota cleanup, expiry cleanup, explicit retention, and the
  rule that active URI leases are never evicted even when the byte target cannot be reached. Run
  with `pnpm --filter player test:storage-policy`.
- [x] A manual deployed-browser probe records media-origin request/byte counts, local-versus-remote
  source types, connectivity, media events, frame quality, and heap samples. It can reset each
  scenario and export JSON evidence from real Chromium/WebView.
- [x] `docs/player-phase15-acceptance.md` provides repeatable Tests A–G, exact pass conditions, the
  minimum 250 MB/3 Mbps/10-player run, and an evidence table for every supported hardware tier.
- [x] The player now has 30 passing deterministic tests: 6 offline + 5 media-sync + 6 media-verify
  + 8 presentation + 2 composed integration + 3 cleanup policy. API manifest coverage remains a
  separate eight-test suite.

Still required before Phase 15 and the player repair are production-qualified:

- [ ] Execute Tests A–G from `docs/player-phase15-acceptance.md` against the deployed PWA with its
  real Service Worker, IndexedDB, OPFS, media origin, and hardware decoder. Attach probe JSON,
  Network logs, build hash, browser/device versions, and pass/fail evidence.
- [ ] Complete the 24-hour offline soak and ten full loops of a five-video playlist with zero
  playback-window media-origin requests, no stuck item, bounded transition delay, and stable
  renderer memory/object-URL/video-element counts.
- [ ] Run cold process/device restart while physically offline and interrupted-candidate reconnect
  tests. Record startup time, partial offset/Range response, exact transferred bytes, and atomic
  revision switch.
- [ ] Run the recommended worst case: 250 MB or larger normalized media over 3 Mbps to ten players
  while their active playlists loop locally; record API/storage bandwidth, CPU, memory, heartbeat
  latency, completion time, and activation time.
- [ ] Test quota exhaustion and browser eviction on real storage. Phase 13 correctly records that
  an explicit `QuotaExceededError` cleanup/retry path and mid-session eviction detection do not yet
  exist; a test cannot truthfully mark those unimplemented behaviors as passing.
- [ ] Inject a decoder no-progress condition in controlled browser automation/test media and prove
  bounded recovery/skip/fallback. Playback recovery and dropped-frame backend telemetry remain the
  deferred portion of Phase 12, so Test G cannot yet satisfy its telemetry clause.

Phase 15 repository coverage is substantially stronger but the phase remains **in progress** until
the real-browser/device evidence above is collected. DOM/Node tests are not substitutes for OPFS,
Service Worker, media decoder, process-restart, storage-pressure, or long-soak qualification.

## 41. Unit Tests

Create tests for:

- Asset version comparison.
- Manifest diff.
- Asset resolver.
- Cleanup policy.
- Playlist activation.
- Retry logic.
- Download state transitions.
- Storage quota handling.

---

## 42. Integration Tests

Test:

```text
Playlist fetch
     ->
Manifest comparison
     ->
Media download
     ->
Validation
     ->
Local storage
     ->
Playlist activation
     ->
Playback
```

Run these tests in a real Chromium/WebView environment with the Service Worker enabled. A DOM-only
unit-test environment cannot validate Service Worker control, Cache/OPFS persistence, range/seek
behavior, media events, or browser storage eviction.

Provide a controllable test media origin that records requests and can simulate slow transfer,
disconnect, incorrect length, corrupt bytes, and Range resume. Assert request counts and byte
counts, not only what appears on screen.

---

## 43. Offline Tests

Required tests:

### Test A

```text
Download playlist
Disconnect internet
Run for 24 hours
```

Expected:

```text
No media playback interruption
```

### Test B

```text
Start player while offline
```

Expected:

```text
Previous valid playlist starts
```

### Test C

```text
Receive new playlist
Disconnect during download
```

Expected:

```text
Old playlist continues
New playlist remains inactive
```

### Test D

```text
Reconnect
```

Expected:

```text
Download resumes/retries
New playlist activates only when ready
```

### Test E — Repeated Multi-Video Loop

```text
Synchronize a playlist with at least five videos
Play ten complete loops
```

Expected:

```text
Exactly one successful full download per unique asset version
Zero media-origin requests during all ten playback loops
No black frame beyond the transition budget
No stuck item
No growth in memory from loop to loop
```

### Test F — Restarted Offline

```text
Synchronize and activate
Close the browser/WebView/process completely
Disconnect network
Restart
```

Expected:

```text
Active content starts from local storage within the startup target
No media-origin request is attempted
No asset is redownloaded
```

### Test G — Decoder Stall

Inject a media element that stops advancing `currentTime` without throwing.

Expected:

```text
Watchdog detects it
Bounded local retry occurs
Player advances or shows fallback
Screen never remains permanently frozen or black
Failure telemetry is emitted
```

---

## 44. Slow Network Tests

Test network speeds such as:

```text
1 Mbps
3 Mbps
5 Mbps
10 Mbps
```

The current playlist must remain unaffected while future assets synchronize.

Also test transition readiness when the candidate takes longer to download than the complete
duration of the active playlist. The active playlist must loop locally without competing network
or decoder work.

---

## 45. Large Video Tests

Test:

```text
100 MB
250 MB
500 MB
1 GB
```

Even if the current upload API does not yet support every size.

This identifies future scalability constraints.

For each size, record peak renderer memory and verify that a small seek/range does not materialize
the full file in JavaScript memory.

---

## 15.1 Recommended Trim — 2026-08-28

§44–46's full combinatorial matrix (4 network speeds × 4 file sizes × 4 fleet sizes = up to 64
combinations) is a large QA ask for a small operations team and mostly tests the same underlying
mechanisms repeatedly. Recommended minimum before wider rollout, in priority order:

1. The Phase 21 Definition of Done scenario end-to-end (already the most complete single test).
2. One representative "worst case" combo: a large video (250 MB+), a throttled connection
   (3 Mbps), and a moderate fleet size (10 players) simultaneously.
3. Offline Tests A–D (§43) — these test the actual reliability property the whole repair exists
   for, and are cheap to run repeatedly.

Expand beyond this only if a specific one of these reveals a real problem — don't pre-run the full
matrix speculatively.

## 46. Multi-Screen Testing

Test at least:

```text
1 player
5 players
10 players
25 players
```

Monitor:

- API bandwidth.
- Storage bandwidth.
- CPU.
- memory.
- active downloads.
- download completion times.

Start all test players at once and with randomized jitter enabled. Verify per-device limits, origin
load, and that the API rate limiter does not count long media transfers against ordinary heartbeat
and state synchronization traffic.

This gives the baseline needed before the later Cloudflare phase.

---

# Phase 16 — Implementation Milestones

## Milestone 0 — Production Stabilization and Instrumentation

Deliver:

- Fix immediate post-cache deletion.
- Remove duplicate full/range transfers.
- Add playback progress watchdog.
- Add cache/download/origin-request diagnostics.
- Record a reproducible, committed player build identifier.

Acceptance:

The currently assigned unchanged video completes repeated loops without another media-origin
request, and a failed video cannot freeze the playlist indefinitely.

---

## Milestone 1 — Asset Manifest

Deliver:

- Stable asset IDs.
- Binary versions and SHA-256 values.
- Correct final-transcode file metadata.
- Recursive dependency-closed manifest response.
- Stable complete-content revision.

Acceptance:

The player can determine:

```text
missing
current
outdated
```

for every required media asset.

Changing nested layout/theme/design content changes `contentRevision`; renaming an unchanged media
asset does not change `binaryVersion`.

---

## Milestone 2 — Local Media Storage

Deliver:

- Storage abstraction.
- Web implementation.
- Asset metadata store.
- Persistent files.
- Persistence/quota reporting.
- Large-file benchmark results on the lowest supported device.

Acceptance:

Restarting Chromium does not force already valid media to download again.

---

## Milestone 3 — Download Manager

Deliver:

- Controlled download queue.
- Retry.
- progress.
- temporary state.
- validation.
- one in-flight owner per asset version.
- cancellation/resume and randomized fleet jitter.

Acceptance:

Large media downloads complete reliably without blocking playback.

---

## Milestone 4 — Local Playback

Deliver:

- Media resolver.
- Local URI playback.
- Updated `ZonePlayer`.
- Prepared current/next slots with constrained-device mode.
- Playback progress watchdog and bounded recovery.
- Stable URI/decoder lifecycle.

Acceptance:

After synchronization:

```text
Disconnect network
```

and video playback continues normally.

A five-video playlist completes ten loops with zero media-origin requests, no permanent black
frame, no stuck item, and no loop-over-loop memory growth.

---

## Milestone 4A — Normalized Playback Rendition

Deliver:

- Documented baseline codec/container/pixel-format/profile/level/bitrate/frame-rate limits.
- Worker probe, final size, checksum, and codec metadata.
- Upload corpus and lowest-tier hardware playback results.

Acceptance:

Every video marked READY by the backend is locally decodable on the supported minimum hardware, or
the backend selects a compatible rendition for that player capability.

---

## Milestone 5 — Atomic Playlist Activation

Deliver:

- Candidate playlist state.
- readiness check.
- previous playlist fallback.

Acceptance:

A partially downloaded playlist never replaces a working playlist.

---

## Milestone 6 — Cache Cleanup

Deliver:

- Orphan detection.
- old-version cleanup.
- storage thresholds.
- previous-playlist retention.

Acceptance:

Storage usage remains bounded while required assets remain protected.

---

## Milestone 7 — Recovery

Deliver:

- offline startup.
- restart recovery.
- reconnect synchronization.

Acceptance:

The player survives:

- restart,
- network loss,
- incomplete download,

without losing valid playback.

---

## Milestone 8 — Telemetry

Deliver:

- sync status.
- cache usage.
- asset readiness.
- failure reporting.

Acceptance:

The backend can determine whether a screen is:

```text
READY
SYNCING
DEGRADED
```

---

# Phase 17 — Performance Acceptance Criteria

## 47. Required Functional Criteria

The repair is complete only when all of the following are true.

### Offline playback

After media synchronization:

```text
Internet connection can be completely removed.
```

The player continues normally.

### Persistent cache

Restarting the player does not redownload unchanged media.

### Atomic deployment

New content does not become active until all required assets are available.

### Safe fallback

Synchronization failure does not interrupt the currently active playlist.

### Asset updates

Changing one media file downloads only that changed asset.

### Asset reuse

If the same asset appears in multiple playlists, only one valid local copy is required.

### Storage cleanup

Unused media does not accumulate forever.

### Recovery

The player can recover from interrupted synchronization.

### Smooth multi-video playback

A playlist of at least five normalized videos completes ten consecutive loops on the lowest
supported device with no network media requests, no permanently black transition, no stuck item,
and no unbounded memory growth.

### Decoder recovery

A simulated zero-progress decoder stall is detected and recovered or skipped within a bounded
time. `playFullVideo` can never wait forever solely because `ended` was not emitted.

### One-transfer invariant

At no point may two network transfers for the same `assetId + binaryVersion` be active on one
player.

---

## 48. Performance Targets

Initial required targets:

```text
Origin media requests after successful synchronization: exactly 0
Downloads for an unchanged unique asset version: exactly 1 successful full transfer
Duplicate concurrent transfers for one asset version: 0
Permanent playback stalls during the acceptance run: 0
Media-origin requests after an offline restart: 0
```

Transition targets must be defined after measuring the lowest supported hardware. As an initial
goal, the next local video should present its first frame within 250 ms of the transition boundary
on the reference device, with no black frame longer than 100 ms. If a device cannot meet that with
two decoders, use the frame-held single-decoder transition and record a device-specific target.

Startup targets:

```text
Warm offline restart to first valid local visual: <= 2 seconds on reference hardware
Playback watchdog detection of no progress: <= 10 seconds by default
Bounded retry/skip decision after detection: <= 10 additional seconds
```

The player should generate normal network traffic only for:

- API synchronization.
- heartbeats.
- new assets.
- changed assets.
- dynamic remote content that intentionally requires internet access.

---

# Phase 18 — Important Guardrails

## 49. Do Not Introduce Cloudflare Yet

This repair phase must remain infrastructure-neutral.

Do not add:

- Cloudflare R2.
- Cloudflare Stream.
- CDN-specific APIs.
- Cloudflare Workers.
- vendor-specific media URLs.

The player must work correctly using the current backend first.

---

## 50. Preserve Storage Abstraction

The implementation must make the later storage migration easy.

Correct dependency direction:

```text
Player
   |
   v
Asset URL / manifest
   |
   v
Storage provider abstraction
```

Not:

```text
Player
   |
   v
Cloudflare-specific implementation
```

The future Cloudflare phase should require minimal player changes.

---

## 51. Do Not Rewrite the Renderer

The purpose of this project is not to replace the current web renderer.

Preserve:

- Existing layout rendering.
- Existing zone logic.
- Existing scheduling logic where correct.
- Existing transitions where correct.
- Existing supported content types.

Modify only the media lifecycle and synchronization architecture required for reliability.

---

## 52. Avoid Dual State Systems

Do not maintain two independent playlist or asset truth models.

The system should have clear authoritative states:

### Server

Authoritative source for:

- Desired playlist.
- Asset metadata.
- versions.

### Player

Authoritative source for:

- Local asset availability.
- Current active local playlist.
- candidate synchronization state.

Avoid duplicated unsynchronized state trees.

---

## 53. Deployment Safety for Schema-Coupled Validation Gates

Added 2026-08-28, from a live incident: a routine `docker compose up -d --build` (done for an
unrelated SSL/DNS fix) rebuilt containers from a working tree that already contained Phase 2's
manifest integrity gate. The Prisma migration auto-applied on boot, but the one-time
`backfill:asset-integrity` worker command — required so existing assets have a verified
`AssetBinary` row — had never been run. Every screen referencing pre-existing media was blocked
(`409 MANIFEST_INTEGRITY_INCOMPLETE`) fleet-wide until the backfill was run by hand.

The gate itself worked exactly as designed — it correctly refused to serve unverified media. The
failure was operational: a hard-fail validation gate went live coupled to a manual migration step
with no automated check that the step had run first.

Rule: any new hard-validation gate that depends on a one-time backfill or data-migration command
must not ship in the same deploy as the code that starts enforcing it, unless one of:

- The backfill is run and its completion verified (e.g. `AssetBinary` row count matches `Asset`
  row count for all binary-bearing types) as an explicit pre-deploy step, or
- The gate degrades gracefully instead of hard-failing until the backfill catches up (see §54), or
- The backfill runs automatically as part of the deploy itself, before the gate is enabled.

This generalizes beyond this one incident: it applies to every future phase that pairs a new
required-data column with code that assumes the column is always populated.

---

## 54. Manifest Validation Should Degrade Per-Asset, Not Fail the Whole Manifest

Recommended follow-up, not yet implemented. `player.service.ts`'s manifest integrity check
(§18/§19, `MANIFEST_INTEGRITY_INCOMPLETE`) currently throws for the entire manifest if *any one*
referenced asset lacks verified binary metadata — confirmed intentional and covered by a
"missing-integrity refusal" test (Phase 2 status). In practice this means one corrupted or
not-yet-processed asset anywhere in a playlist blanks the whole screen instead of just dropping
that one item, which contradicts §38's "No Blank Screen Rule" and the §47 "safe fallback"
acceptance criterion.

Today's incident happened to hit every asset at once (0/20 backfilled), so this distinction didn't
change the outcome this time. But going forward, a single bad asset in an otherwise-healthy
10-item playlist would still take the whole screen down under the current behavior. Recommended
fix: filter unverified items out of `desiredState`'s playlists/themes/designs at hydration time
(alongside `referencedIds` collection) and only fail the manifest if the *resulting* content set is
empty, matching how `resolvePlaylist` already falls back through emergency → schedule → default.

---

# Phase 19 — Recommended Module Structure

Suggested structure:

```text
apps/player/src/

  lib/
    media-manifest/
      types.ts
      diff.ts

    media-storage/
      index.ts
      indexeddb-storage.ts
      metadata-store.ts

    media-sync/
      download-manager.ts
      retry-policy.ts
      validator.ts

    media-resolver/
      resolver.ts

    playlist-runtime/
      activation-manager.ts
      local-playlist-store.ts

    storage-cleanup/
      cleanup-manager.ts
      cleanup-policy.ts
```

The exact filenames may be adapted to the existing project structure.

The architectural separation is more important than the folder names.

---

# Phase 20 — Implementation Order

Use this order:

```text
0. Stabilize production cache deletion, duplicate transfers, and stuck-video recovery
1. Add temporary request/cache/playback instrumentation and record the baseline
2. Document the complete current flow and content dependency graph
3. Correct final-transcode size metadata; add checksum and binary version metadata
4. Define the complete content manifest and stable contentRevision
5. Prototype OPFS, Cache Storage, and fallback storage on the lowest supported hardware
6. Select and implement the persistent media-storage adapter
7. Implement the single-owner download manager, resume/retry, and validation
8. Implement candidate/active/previous state and transactional atomic activation
9. Implement the local media resolver and prohibit implicit remote rendering
10. Implement normalized rendition enforcement and playback capability probes
11. Implement prepared current/next playback slots and single-decoder fallback
12. Implement the playback progress watchdog and bounded retry/skip behavior
13. Add immediate offline startup, restart reconciliation, and reconnect synchronization
14. Add protected byte-aware cleanup and storage persistence/quota handling
15. Add permanent telemetry and dashboard operational status
16. Run browser, lowest-device, multi-screen, stress, and 24-hour offline tests
17. Canary one production screen, compare origin logs, then roll out gradually
```

Do not change several architectural layers simultaneously without validating each milestone.

---

# Phase 21 — Definition of Done

The player repair project is complete when this scenario works reliably:

```text
1. Player starts online.

2. Player receives Playlist A.

3. Player downloads all Playlist A assets.

3a. Every unique asset version produces exactly one full network transfer.

4. Player activates Playlist A.

5. Internet is disconnected.

6. Playlist A continues playing indefinitely.

6a. Playlist A contains at least five normalized videos and completes ten measured loops with zero
media-origin traffic, no stuck item, and transitions within the device target.

7. Player restarts while still offline.

8. Playlist A starts again from local storage.

8a. No media-origin request is attempted during the offline restart.

9. Internet reconnects.

10. Server sends Playlist B.

11. Player continues Playlist A.

12. Player downloads Playlist B assets in background.

13. One download temporarily fails.

14. Playlist A continues.

15. Download retries successfully.

16. Playlist B becomes fully ready.

17. Player atomically switches to Playlist B.

18. Old unused assets are cleaned according to policy.

19. A forced zero-progress decoder stall is detected; the player recovers locally or skips the
failed item without freezing or blanking the screen.

20. Restarting online again does not redownload any unchanged Playlist B asset.
```

If this complete scenario does not pass, the player repair is not finished.

---

# Phase 22 — Post-Repair Measurement

After all repair milestones are complete, repeat the baseline tests from Phase 1.

Compare:

- Startup delay.
- Rebuffering.
- server bandwidth.
- media requests.
- local disk use.
- recovery behavior.
- concurrent-screen performance.

Only after these results are available should infrastructure optimization begin.

---

# Phase 23 — Next Project: Cloudflare Evaluation

Cloudflare is explicitly outside the scope of this document.

After the repaired player is stable, create a separate plan:

```text
cloudflare_media_plan.md
```

That plan should evaluate:

- Current media origin performance.
- Cloudflare R2.
- Cloudflare CDN.
- Direct asset delivery.
- Signed/private URLs.
- Cache policy.
- Cloudflare Stream only if required.
- upload architecture.
- bandwidth reduction.
- cost.
- migration from current S3-compatible storage.
- rollback strategy.

The decision to adopt Cloudflare should be based on measurements from the repaired player, not used as a substitute for fixing the player architecture.

---

# Final Principle

The Lumina player should behave like a professional signage appliance:

> Synchronize while online.
>
> Play from local storage.
>
> Survive internet failure.
>
> Update atomically.
>
> Never replace working content with incomplete content.

Once this architecture is implemented and verified, Cloudflare can be evaluated as the next independent optimization layer.
