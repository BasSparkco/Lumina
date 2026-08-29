-- AlterTable
ALTER TABLE "Playlist" ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Playlist_organizationId_sortOrder_idx" ON "Playlist"("organizationId", "sortOrder");
