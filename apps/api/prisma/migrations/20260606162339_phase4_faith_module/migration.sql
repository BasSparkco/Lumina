-- CreateEnum
CREATE TYPE "ZoneType" AS ENUM ('MEDIA', 'PRAYER', 'WEATHER', 'CURRENCY', 'TICKER');

-- AlterTable
ALTER TABLE "Screen" ADD COLUMN     "athanEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "prayerMethod" TEXT NOT NULL DEFAULT 'UmmAlQura';

-- AlterTable
ALTER TABLE "Zone" ADD COLUMN     "widgetConfig" JSONB,
ADD COLUMN     "zoneType" "ZoneType" NOT NULL DEFAULT 'MEDIA';
