/*
  Warnings:

  - The `textFontFamily` column on the `Asset` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the column `contentType` on the `Screen` table. All the data in the column will be lost.

*/
-- AlterEnum
ALTER TYPE "StreamingType" ADD VALUE 'THEME';

-- AlterTable
ALTER TABLE "Asset" DROP COLUMN "textFontFamily",
ADD COLUMN     "textFontFamily" TEXT;

-- AlterTable
ALTER TABLE "Screen" DROP COLUMN "contentType";

-- AlterTable
ALTER TABLE "Zone" ADD COLUMN     "rotation" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- DropEnum
DROP TYPE "ScreenContentType";

-- DropEnum
DROP TYPE "TextFontFamily";
