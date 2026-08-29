-- Phase 12 player manifest: sync telemetry reported by the player on each heartbeat, distinct
-- from ScreenStatus (network reachability). Defaults read as "never synced" for a screen that
-- hasn't sent a heartbeat under the new fields yet, rather than silently looking healthy.
CREATE TYPE "SyncState" AS ENUM ('UNKNOWN', 'SYNCING', 'READY', 'DEGRADED', 'FAILED');

ALTER TABLE "Screen"
    ADD COLUMN "syncState" "SyncState" NOT NULL DEFAULT 'UNKNOWN',
    ADD COLUMN "assetsTotal" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "assetsReady" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "assetsDownloading" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "assetsFailed" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "cacheBytes" BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN "freeStorageBytes" BIGINT,
    ADD COLUMN "storagePersistent" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "lastSuccessfulSyncAt" TIMESTAMP(3);
