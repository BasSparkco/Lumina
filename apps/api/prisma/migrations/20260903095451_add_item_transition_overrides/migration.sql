-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TransitionStyle" ADD VALUE 'FADE';
ALTER TYPE "TransitionStyle" ADD VALUE 'SLIDE_LEFT';
ALTER TYPE "TransitionStyle" ADD VALUE 'SLIDE_RIGHT';
ALTER TYPE "TransitionStyle" ADD VALUE 'ZOOM';
ALTER TYPE "TransitionStyle" ADD VALUE 'FLIP';

-- AlterTable
ALTER TABLE "PlaylistItem" ADD COLUMN     "transitionDurationMs" INTEGER,
ADD COLUMN     "transitionStyle" "TransitionStyle";
