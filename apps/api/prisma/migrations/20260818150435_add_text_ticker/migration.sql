-- CreateEnum
CREATE TYPE "TickerDirection" AS ENUM ('HORIZONTAL', 'VERTICAL');

-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "textTickerDirection" "TickerDirection" NOT NULL DEFAULT 'HORIZONTAL',
ADD COLUMN     "textTickerEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "textTickerSpeed" INTEGER;
