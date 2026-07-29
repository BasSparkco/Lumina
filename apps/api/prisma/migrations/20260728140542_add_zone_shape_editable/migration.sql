-- CreateEnum
CREATE TYPE "ZoneShape" AS ENUM ('rectangle', 'rounded', 'circle', 'ellipse', 'triangle');

-- AlterTable
ALTER TABLE "Zone" ADD COLUMN     "editable" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "shape" "ZoneShape" NOT NULL DEFAULT 'rectangle';
