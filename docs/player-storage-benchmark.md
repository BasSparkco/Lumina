# Player Persistent Storage Benchmark

Status: protocol ready; target-device results pending.

This benchmark decides whether the Phase 3 OPFS prototype can become Lumina's production web
media backend. Desktop results are useful for debugging but cannot approve the adapter. Run the
complete matrix on the lowest supported signage device and at least one representative production
device/browser build.

## Test media

Prepare normalized MP4 files near each target size. They must use the exact codec, profile, level,
pixel format, audio format, frame rate, and maximum resolution accepted by the worker pipeline.
Synthetic or random byte files can measure write throughput, but cannot approve playback or seek
behavior.

| Case | Approximate size | Duration | Resolution/profile | SHA-256 |
|---|---:|---:|---|---|
| S40 | 40 MB | pending | pending | pending |
| S100 | 100 MB | pending | pending | pending |
| S250 | 250 MB | pending | pending | pending |
| S500 | 500 MB | pending | pending | pending |
| S1000 | 1 GB | pending | pending | pending |

## Environment record

Record device model, CPU, RAM, free disk, OS, browser/WebView version, Lumina commit, display
resolution, network shape, storage persistence result, origin quota, and whether the run started
from a clean origin.

## Procedure for every file size

1. Clear Lumina local data and confirm OPFS/IndexedDB/Cache Storage are empty.
2. Open the player, request durable storage, and record `READY`, `DEGRADED`, or `UNAVAILABLE`.
3. Save the media through the OPFS adapter using a streamed response body. Record elapsed time,
   average write throughput, peak JavaScript heap, total process memory, and CPU.
4. Close and reopen the browser. With the network disabled, confirm metadata reconciliation finds
   the same file and creates a local URI without an origin request.
5. Start playback and record time to metadata, time to first frame, CPU, memory, dropped frames,
   and decoder errors.
6. Seek to 10%, 50%, and 90% in a cold session, then repeat the seeks in a warm session. Record
   time to resumed frames and any large JavaScript-heap increase.
7. Loop the file three times, then alternate it in a five-video playlist for ten complete loops.
   Confirm object URLs remain stable while active/prepared and origin media requests remain zero.
8. Restart offline and replay the playlist. Confirm no valid binary is rewritten or redownloaded.
9. Interrupt one write, restart, and confirm reconciliation removes the orphan while preserving
   every committed file.
10. Apply quota pressure and LRU cleanup. Confirm active and retained versions are never evicted,
    and a denied persistence grant remains visibly `DEGRADED`.

## Required evidence

- Browser performance trace and memory measurements.
- `chrome://media-internals` or equivalent decoder/frame evidence.
- Network capture proving zero media-origin bytes during local playback and later loops.
- IndexedDB metadata export plus OPFS file list before and after restart/reconciliation.
- Structured player console diagnostics and API/origin request logs.
- A completed results table for every target device and file size.

## Acceptance rules

The adapter fails qualification if any tested size reconstructs the complete file in JavaScript
memory during playback/seek, contacts the remote media URL during normal local playback, loses a
committed file on restart, serves a partial/orphan file, evicts an active lease, or produces
unbounded startup/seek stalls. Exact startup, seek, CPU, and dropped-frame budgets must be agreed
for the lowest supported hardware tier and entered below before execution.

| Device | File | Write | First frame | Seek p95 | Peak JS heap | Peak process memory | Dropped frames | Offline restart | Result |
|---|---|---:|---:|---:|---:|---:|---:|---|---|
| pending | S40 | pending | pending | pending | pending | pending | pending | pending | pending |
| pending | S100 | pending | pending | pending | pending | pending | pending | pending | pending |
| pending | S250 | pending | pending | pending | pending | pending | pending | pending | pending |
| pending | S500 | pending | pending | pending | pending | pending | pending | pending | pending |
| pending | S1000 | pending | pending | pending | pending | pending | pending | pending | pending |

## Fallback decision

If any supported browser lacks OPFS or OPFS fails this matrix, implement a separate adapter behind
the same `MediaStorage` contract. The fallback must run this identical matrix. Do not silently fall
back to the Phase 0 Service Worker cache or claim `READY` when persistent local playback is not
qualified.

