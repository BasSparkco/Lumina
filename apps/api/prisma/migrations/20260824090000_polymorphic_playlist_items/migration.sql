-- CreateEnum
CREATE TYPE "PlaylistItemKind" AS ENUM ('ASSET', 'THEME', 'LAYOUT');

-- AlterTable: assetId becomes optional (a THEME/LAYOUT item has no asset), and gains a `kind`
-- discriminator plus the two new content FKs.
ALTER TABLE "PlaylistItem"
  ALTER COLUMN "assetId" DROP NOT NULL,
  ADD COLUMN "kind" "PlaylistItemKind" NOT NULL DEFAULT 'ASSET',
  ADD COLUMN "themeId" TEXT,
  ADD COLUMN "layoutId" TEXT;

-- AddForeignKey
ALTER TABLE "PlaylistItem" ADD CONSTRAINT "PlaylistItem_themeId_fkey" FOREIGN KEY ("themeId") REFERENCES "Theme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlaylistItem" ADD CONSTRAINT "PlaylistItem_layoutId_fkey" FOREIGN KEY ("layoutId") REFERENCES "Layout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CheckConstraint: exactly one of assetId/themeId/layoutId is set, and it matches `kind` — not
-- expressible in schema.prisma, so it only ever lives here.
ALTER TABLE "PlaylistItem" ADD CONSTRAINT "PlaylistItem_kind_ref_check" CHECK (
  (kind = 'ASSET' AND "assetId" IS NOT NULL AND "themeId" IS NULL AND "layoutId" IS NULL) OR
  (kind = 'THEME' AND "themeId" IS NOT NULL AND "assetId" IS NULL AND "layoutId" IS NULL) OR
  (kind = 'LAYOUT' AND "layoutId" IS NOT NULL AND "assetId" IS NULL AND "themeId" IS NULL)
);
