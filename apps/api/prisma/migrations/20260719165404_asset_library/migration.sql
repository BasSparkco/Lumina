-- CreateEnum
CREATE TYPE "AssetCategory" AS ENUM ('BACKGROUND', 'ICON', 'ILLUSTRATION', 'STOCK_PHOTO', 'LOGO', 'VIDEO_LOOP', 'AUDIO_JINGLE', 'GENERIC');

-- DropForeignKey
ALTER TABLE "Asset" DROP CONSTRAINT "Asset_organizationId_fkey";

-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "category" "AssetCategory" NOT NULL DEFAULT 'GENERIC',
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ALTER COLUMN "organizationId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Asset_organizationId_category_idx" ON "Asset"("organizationId", "category");

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
