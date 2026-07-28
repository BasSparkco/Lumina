-- CreateEnum
CREATE TYPE "ScreenContentType" AS ENUM ('VIDEO', 'IMAGE', 'PLAYLIST', 'THEME');

-- AlterTable
ALTER TABLE "PlaylistItem" ADD COLUMN     "playFullVideo" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Screen" ADD COLUMN     "assetId" TEXT,
ADD COLUMN     "contentType" "ScreenContentType",
ADD COLUMN     "timezoneEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "Screen" ADD CONSTRAINT "Screen_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
