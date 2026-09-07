/*
  Warnings:

  - Made the column `organizationId` on table `Screen` required. This step will fail if there are existing NULL values in that column.

*/

-- P5a schema task 4 (docs/tenant_isolation_and_platform_admin_plan.md) — the pre-migration audit
-- (db:audit-p5a-tenant-relations, 2026-09-05) found and deleted the 68 unowned Screen rows that
-- existed then; this repeats that same delete immediately before the NOT NULL is applied, since
-- POST /player/init could have created more null-org rows in the time since (that mechanism isn't
-- replaced by PairingSession until this same migration lands). Every row this matches is by
-- definition an unpaired, never-claimed pairing artifact — never a real tenant screen, which
-- always has organizationId set from the moment ScreensService.confirmPairing creates it.
DELETE FROM "Screen" WHERE "organizationId" IS NULL;

-- AlterTable
ALTER TABLE "Screen" ADD COLUMN     "pairingCodeIssuedAt" TIMESTAMP(3),
ALTER COLUMN "organizationId" SET NOT NULL;

-- CreateTable
CREATE TABLE "PairingSession" (
    "id" TEXT NOT NULL,
    "pairingCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PairingSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PairingSession_pairingCode_key" ON "PairingSession"("pairingCode");
