-- CreateEnum
CREATE TYPE "TransitionStyle" AS ENUM ('NONE', 'CROSSFADE');

-- CreateEnum
CREATE TYPE "PlaybackOrder" AS ENUM ('SEQUENTIAL', 'SHUFFLE');

-- AlterTable
ALTER TABLE "Playlist" ADD COLUMN     "playbackOrder" "PlaybackOrder" NOT NULL DEFAULT 'SEQUENTIAL',
ADD COLUMN     "transitionDurationMs" INTEGER NOT NULL DEFAULT 500,
ADD COLUMN     "transitionStyle" "TransitionStyle" NOT NULL DEFAULT 'NONE';

-- AlterTable
ALTER TABLE "Screen" ADD COLUMN     "hasContent" BOOLEAN NOT NULL DEFAULT false;
