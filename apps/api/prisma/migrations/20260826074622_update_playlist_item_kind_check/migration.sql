-- Extends PlaylistItem_kind_ref_check (from 20260824090000_polymorphic_playlist_items) to cover
-- the new DESIGN kind/designAssetId column. Split into its own migration, separate from the
-- migration that added the 'DESIGN' enum value (20260826074541) — Postgres forbids referencing a
-- newly-added enum value in the same transaction that added it.
ALTER TABLE "PlaylistItem" DROP CONSTRAINT "PlaylistItem_kind_ref_check";
ALTER TABLE "PlaylistItem" ADD CONSTRAINT "PlaylistItem_kind_ref_check" CHECK (
  (kind = 'ASSET' AND "assetId" IS NOT NULL AND "themeId" IS NULL AND "layoutId" IS NULL AND "designAssetId" IS NULL) OR
  (kind = 'THEME' AND "themeId" IS NOT NULL AND "assetId" IS NULL AND "layoutId" IS NULL AND "designAssetId" IS NULL) OR
  (kind = 'LAYOUT' AND "layoutId" IS NOT NULL AND "assetId" IS NULL AND "themeId" IS NULL AND "designAssetId" IS NULL) OR
  (kind = 'DESIGN' AND "designAssetId" IS NOT NULL AND "assetId" IS NULL AND "themeId" IS NULL AND "layoutId" IS NULL)
);
