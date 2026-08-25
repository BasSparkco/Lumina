-- AlterEnum
ALTER TYPE "AssetType" ADD VALUE 'APP';

-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "appConfig" JSONB,
ADD COLUMN     "appProviderId" TEXT,
ADD COLUMN     "sourceUrl" TEXT;
