-- AlterEnum
ALTER TYPE "StreamingType" ADD VALUE 'APPS';

-- AlterTable
ALTER TABLE "Screen" ADD COLUMN     "appAssetId" TEXT;

-- AddForeignKey
ALTER TABLE "Screen" ADD CONSTRAINT "Screen_appAssetId_fkey" FOREIGN KEY ("appAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
