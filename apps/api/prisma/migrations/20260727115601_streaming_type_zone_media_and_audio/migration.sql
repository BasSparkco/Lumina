-- CreateEnum
CREATE TYPE "StreamingType" AS ENUM ('ASSET', 'PLAYLIST', 'LAYOUT');

-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "audioEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "hasAudioTrack" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
-- Screen.assetId already exists — added by 20260723124251_screen_streaming_type.
ALTER TABLE "Screen" ADD COLUMN     "streamingType" "StreamingType" NOT NULL DEFAULT 'PLAYLIST';

-- AlterTable
ALTER TABLE "Zone" ADD COLUMN     "assetId" TEXT,
ADD COLUMN     "audioPriority" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "audioVolume" INTEGER;

-- AddForeignKey
ALTER TABLE "Zone" ADD CONSTRAINT "Zone_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: streamingType defaults to PLAYLIST above for every existing row, which is correct
-- for screens that never had a layout — but a screen that already had a layoutId assigned was
-- actually in layout mode, so its streamingType must reflect that rather than silently switching
-- it to playlist mode on migrate.
UPDATE "Screen" SET "streamingType" = 'LAYOUT' WHERE "layoutId" IS NOT NULL;
