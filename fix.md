# Fix Roadmap: Missing Asset Files & Failed Uploads

Investigated 2026-08-27. Two symptoms reported: (1) assets show a name in the
UI but the file doesn't load, for `admin@demo.com` and a "testing" account;
(2) uploads are currently failing/hanging on prod.

## Root causes found

1. **[P0 — live, confirmed] `S3Client` has no request/connection timeout.**
   `apps/api/src/modules/storage/storage.service.ts` constructs the AWS SDK
   v3 `S3Client` with no `requestHandler` config. When the connection to
   MinIO stalls (e.g. MinIO's container being recreated while the API holds
   a stale pooled keep-alive socket), `GetObjectCommand`/`PutObjectCommand`
   hang indefinitely instead of failing fast. Confirmed in prod Traefik
   logs: `GET /v1/media/.../assets/*.webp` hung 468s before the client gave
   up (499); `POST /v1/assets/upload` hung 93–150s before "request aborted".
   This alone explains both symptoms — a stalled image GET looks like "the
   file doesn't exist," and a stalled PUT looks like "can't upload."

2. **[P0 — narrower, real] TOCTOU race between `copyFromLibrary()` and
   `remove()`/`removeFromLibrary()`.** `apps/api/src/modules/assets/assets.service.ts:419-449`
   creates a new tenant Asset row that shares `storageKey` with the library
   source, no re-upload. `remove()`/`removeFromLibrary()` (lines 809-853,
   516-533) count other rows on that `storageKey` and delete the object if
   the count is 0. A `copyFromLibrary` landing in the window between that
   count and the delete produces a named Asset row pointing at a
   just-deleted object — orphaned by design, not by the timeout bug above.

3. **[P1] `TemplatesService.adminCreate`/`adminUpdate` never validate asset
   ownership.** `apps/api/src/modules/templates/templates.service.ts:39-53,55-68`
   persist `designJson` without calling `assertAssetsOwned`, unlike
   `DesignsService`. `createFromTemplate` (designs.service.ts:80-91) also
   skips it. A template — and every design cloned from it — can carry
   `assetId`s that were never checked to exist.

4. **[P1] `AssetsService.remove()`'s usage guard doesn't check
   `DesignAsset`/`DesignTemplate.designJson`.** It checks
   Playlist/Screen/Zone references but designer2 added two more places an
   asset can be referenced from, and neither is guarded. Deleting an asset
   used inside a saved design silently leaves a dangling `assetId`.

5. **[P2 — leak, not breakage] Worker never deletes pre-transcode video
   originals.** `apps/worker/src/processors/media.processor.ts:146-165`
   updates `Asset.storageKey` to the transcoded file but leaves the
   original object behind — orphaned storage, but not a broken reference,
   so lowest priority.

## Steps

- [x] **Step 1 — Add S3Client timeouts + fail-fast retry config.** Stops the
      live hangs on both upload and media-serving immediately. Config-only,
      no schema/data changes, safe to ship first.
      Done: `apps/api/src/modules/storage/storage.service.ts` now builds the
      `S3Client` with `requestHandler: new NodeHttpHandler({ connectionTimeout: 5_000, socketTimeout: 30_000 })`.
      `socketTimeout` is an inactivity timeout (resets on any data flow), so
      it won't cut off a slow-but-progressing large upload/download — only a
      truly stalled connection. Added `@smithy/node-http-handler` as a
      direct dependency of `apps/api` (was already a transitive dep of the
      AWS SDK). Built and deployed to prod (`lumina-api-1` recreated
      2026-08-27); typecheck clean, container healthy post-restart, direct
      MinIO GET/PUT confirmed fast (~34ms) on the new container.
- [ ] **Step 2 — Fix the `copyFromLibrary`/`remove` race.** Make the
      "count refs then delete" sequence atomic (transaction with row lock,
      or switch `copyFromLibrary` to a real object copy instead of a shared
      key) so a copy can never observe a mid-deletion key.
- [ ] **Step 3 — Add `assertAssetsOwned` to `TemplatesService.adminCreate`/`adminUpdate`
      and `DesignsService.createFromTemplate`.**
- [ ] **Step 4 — Extend `AssetsService.remove()`'s usage guard to check
      `DesignAsset`/`DesignTemplate.designJson` references**, matching the
      existing Playlist/Screen/Zone checks.
- [ ] **Step 5 — Clean up orphaned pre-transcode video originals** in the
      worker's transcode step; sweep already-leaked objects in a one-off
      script.
- [ ] **Step 6 — Audit current prod data**: find any Asset rows whose
      `storageKey` has no backing object (cross-reference DB vs MinIO
      listing) and repair/flag them for the two affected accounts and any
      others found.

Starting on Step 1 now.
