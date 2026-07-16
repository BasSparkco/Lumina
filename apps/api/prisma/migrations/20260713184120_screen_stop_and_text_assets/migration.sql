-- AlterEnum
ALTER TYPE "AssetType" ADD VALUE 'TEXT';

-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "textContent" TEXT;

-- AlterTable
ALTER TABLE "Screen" ADD COLUMN     "stopped" BOOLEAN NOT NULL DEFAULT false;
