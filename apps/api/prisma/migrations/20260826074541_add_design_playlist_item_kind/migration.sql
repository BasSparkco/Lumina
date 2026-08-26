-- AlterEnum
ALTER TYPE "PlaylistItemKind" ADD VALUE 'DESIGN';

-- AlterTable
ALTER TABLE "PlaylistItem" ADD COLUMN     "designAssetId" TEXT;

-- AddForeignKey
ALTER TABLE "PlaylistItem" ADD CONSTRAINT "PlaylistItem_designAssetId_fkey" FOREIGN KEY ("designAssetId") REFERENCES "DesignAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
