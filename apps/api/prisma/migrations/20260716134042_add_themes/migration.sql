-- CreateEnum
CREATE TYPE "ThemeCategory" AS ENUM ('RESTAURANT_MENU', 'RETAIL_PROMO', 'HOTEL_LOBBY', 'CLINIC_WAITING', 'MOSQUE', 'GENERIC');

-- AlterTable
ALTER TABLE "Screen" ADD COLUMN     "themeId" TEXT;

-- CreateTable
CREATE TABLE "Theme" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "ThemeCategory" NOT NULL DEFAULT 'GENERIC',
    "aspectRatio" TEXT NOT NULL DEFAULT '16:9',
    "palette" JSONB NOT NULL,
    "typography" JSONB NOT NULL,
    "elements" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT,

    CONSTRAINT "Theme_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Screen" ADD CONSTRAINT "Screen_themeId_fkey" FOREIGN KEY ("themeId") REFERENCES "Theme"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Theme" ADD CONSTRAINT "Theme_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
