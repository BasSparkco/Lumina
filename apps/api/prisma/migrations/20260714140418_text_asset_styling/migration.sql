-- CreateEnum
CREATE TYPE "TextFontFamily" AS ENUM ('SANS', 'SERIF', 'MONOSPACE');

-- CreateEnum
CREATE TYPE "TextSize" AS ENUM ('SMALL', 'MEDIUM', 'LARGE', 'XLARGE');

-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "textColor" TEXT,
ADD COLUMN     "textFontFamily" "TextFontFamily",
ADD COLUMN     "textSize" "TextSize";
