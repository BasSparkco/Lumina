-- DropForeignKey
ALTER TABLE "Screen" DROP CONSTRAINT "Screen_layoutId_fkey";
ALTER TABLE "Screen" DROP CONSTRAINT "Screen_themeId_fkey";
ALTER TABLE "Screen" DROP CONSTRAINT "Screen_appAssetId_fkey";

-- AlterTable: Layout/Theme/Apps are no longer directly assignable to a Screen — the previous
-- migration already moved every screen that had one of these set into Playlist mode wrapping the
-- same content, so nothing here needs a fallback value.
ALTER TABLE "Screen"
  DROP COLUMN "layoutId",
  DROP COLUMN "themeId",
  DROP COLUMN "appAssetId";

-- AlterEnum: shrink StreamingType to ASSET | PLAYLIST | WAYFINDING. Postgres can't drop enum
-- values directly, so this recreates the type and re-points the column at it — safe only because
-- the previous migration guaranteed no row still has LAYOUT/THEME/APPS.
ALTER TYPE "StreamingType" RENAME TO "StreamingType_old";
CREATE TYPE "StreamingType" AS ENUM ('ASSET', 'PLAYLIST', 'WAYFINDING');
ALTER TABLE "Screen" ALTER COLUMN "streamingType" DROP DEFAULT;
ALTER TABLE "Screen" ALTER COLUMN "streamingType" TYPE "StreamingType" USING ("streamingType"::text::"StreamingType");
ALTER TABLE "Screen" ALTER COLUMN "streamingType" SET DEFAULT 'PLAYLIST';
DROP TYPE "StreamingType_old";
