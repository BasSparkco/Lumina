-- DropIndex
DROP INDEX "DesignDraft_documentId_key";

-- DropIndex
DROP INDEX "DesignDraft_organizationId_documentId_idx";

-- AlterTable
ALTER TABLE "PlatformAuditLog" ADD COLUMN     "targetOrganizationId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "DesignDraft_organizationId_documentId_key" ON "DesignDraft"("organizationId", "documentId");

-- CreateIndex
CREATE INDEX "PlatformAuditLog_targetOrganizationId_createdAt_idx" ON "PlatformAuditLog"("targetOrganizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "PlatformAuditLog" ADD CONSTRAINT "PlatformAuditLog_targetOrganizationId_fkey" FOREIGN KEY ("targetOrganizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- P5a (docs/tenant_isolation_and_platform_admin_plan.md schema task 5) — a tenant AuditLog row's
-- userId, when present, must belong to the same organization as the row itself. A plain composite
-- foreign key can't express this safely: AuditLog.organizationId is NOT NULL, but User deletion
-- (OrgService.removeMember) must still be able to SET NULL only userId when a member is removed —
-- a composite FK's ON DELETE SET NULL would null out organizationId too, violating its NOT NULL
-- constraint. Prisma schema syntax has no way to express a trigger (see RoomReservation's own
-- EXCLUDE USING gist constraint, added the same hand-written way, for the established
-- convention), so this is hand-added here rather than generated. Only fires on INSERT/UPDATE of
-- AuditLog itself — User deletion's existing single-column ON DELETE SET NULL on userId is
-- untouched and still works exactly as before.
CREATE OR REPLACE FUNCTION check_auditlog_actor_same_org() RETURNS trigger AS $$
BEGIN
  IF NEW."userId" IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM "User" WHERE id = NEW."userId" AND "organizationId" = NEW."organizationId"
    ) THEN
      RAISE EXCEPTION 'AuditLog.userId % does not belong to AuditLog.organizationId %', NEW."userId", NEW."organizationId";
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS auditlog_actor_same_org ON "AuditLog";
CREATE TRIGGER auditlog_actor_same_org
  BEFORE INSERT OR UPDATE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION check_auditlog_actor_same_org();
