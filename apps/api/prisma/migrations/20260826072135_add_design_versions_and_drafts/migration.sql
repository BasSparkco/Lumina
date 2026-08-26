-- AlterTable
ALTER TABLE "DesignAsset" ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "DesignAssetVersion" (
    "id" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "designJson" JSONB NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    "designAssetId" TEXT NOT NULL,

    CONSTRAINT "DesignAssetVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DesignDraft" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "draftJson" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DesignDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DesignAssetVersion_designAssetId_versionNumber_key" ON "DesignAssetVersion"("designAssetId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "DesignDraft_documentId_key" ON "DesignDraft"("documentId");

-- CreateIndex
CREATE INDEX "DesignDraft_organizationId_documentId_idx" ON "DesignDraft"("organizationId", "documentId");

-- AddForeignKey
ALTER TABLE "DesignAssetVersion" ADD CONSTRAINT "DesignAssetVersion_designAssetId_fkey" FOREIGN KEY ("designAssetId") REFERENCES "DesignAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignDraft" ADD CONSTRAINT "DesignDraft_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
