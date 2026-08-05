-- AlterEnum
ALTER TYPE "AssetType" ADD VALUE 'DOCUMENT';

-- AlterTable
ALTER TABLE "Asset" ADD COLUMN "pageCount" INTEGER;
