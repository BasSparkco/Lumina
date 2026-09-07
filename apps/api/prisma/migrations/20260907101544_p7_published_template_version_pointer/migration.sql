-- P7 (docs/tenant_isolation_and_platform_admin_plan.md) — customer-visible resolution must point
-- at an immutable DesignTemplateVersion, never the live mutable DesignTemplate.designJson.

-- AlterTable
ALTER TABLE "DesignTemplate" ADD COLUMN     "publishedVersionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "DesignTemplate_publishedVersionId_key" ON "DesignTemplate"("publishedVersionId");

-- AddForeignKey
ALTER TABLE "DesignTemplate" ADD CONSTRAINT "DesignTemplate_publishedVersionId_fkey" FOREIGN KEY ("publishedVersionId") REFERENCES "DesignTemplateVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: every currently PUBLISHED template's versionNumber already equals the versionNumber
-- of the DesignTemplateVersion snapshot adminPublish created for it (TemplatesService.adminPublish
-- has always bumped both together in the same transaction) — so the matching version row is always
-- the one just created by that template's most recent publish. A template can only reach PUBLISHED
-- through adminPublish, which always creates a version first, so every PUBLISHED row has a match.
UPDATE "DesignTemplate" t
SET "publishedVersionId" = v.id
FROM "DesignTemplateVersion" v
WHERE t.status = 'PUBLISHED'
  AND v."templateId" = t.id
  AND v."versionNumber" = t."versionNumber";
