-- Phase 2 player manifest: authoritative per-binary integrity metadata. Kept separate from
-- Asset.updatedAt so metadata-only edits (for example a rename) never invalidate large media.
CREATE TYPE "AssetBinaryKind" AS ENUM ('PRIMARY', 'DOCUMENT_PAGE');

CREATE TABLE "AssetBinary" (
    "id" TEXT NOT NULL,
    "kind" "AssetBinaryKind" NOT NULL,
    "ordinal" INTEGER NOT NULL DEFAULT 0,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "assetId" TEXT NOT NULL,

    CONSTRAINT "AssetBinary_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AssetBinary_assetId_kind_ordinal_key"
    ON "AssetBinary"("assetId", "kind", "ordinal");
CREATE INDEX "AssetBinary_sha256_idx" ON "AssetBinary"("sha256");

ALTER TABLE "AssetBinary"
    ADD CONSTRAINT "AssetBinary_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
