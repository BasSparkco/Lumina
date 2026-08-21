-- AlterTable
ALTER TABLE "KioskLocation" ADD COLUMN     "attractPlaylistId" TEXT,
ADD COLUMN     "attractThemeId" TEXT;

-- AddForeignKey
ALTER TABLE "KioskLocation" ADD CONSTRAINT "KioskLocation_attractPlaylistId_fkey" FOREIGN KEY ("attractPlaylistId") REFERENCES "Playlist"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KioskLocation" ADD CONSTRAINT "KioskLocation_attractThemeId_fkey" FOREIGN KEY ("attractThemeId") REFERENCES "Theme"("id") ON DELETE SET NULL ON UPDATE CASCADE;
