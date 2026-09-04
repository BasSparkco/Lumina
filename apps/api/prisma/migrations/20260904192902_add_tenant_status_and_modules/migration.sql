-- CreateEnum
CREATE TYPE "OrganizationStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "TenantModuleStatus" AS ENUM ('ACTIVE', 'TRIAL', 'DISABLED');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateTable
CREATE TABLE "TenantModule" (
    "id" TEXT NOT NULL,
    "moduleKey" TEXT NOT NULL,
    "status" "TenantModuleStatus" NOT NULL DEFAULT 'ACTIVE',
    "enabledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "TenantModule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TenantModule_organizationId_status_idx" ON "TenantModule"("organizationId", "status");

-- CreateIndex
CREATE INDEX "TenantModule_expiresAt_idx" ON "TenantModule"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "TenantModule_organizationId_moduleKey_key" ON "TenantModule"("organizationId", "moduleKey");

-- AddForeignKey
ALTER TABLE "TenantModule" ADD CONSTRAINT "TenantModule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every organization that existed before this migration keeps its current Wayfinding
-- access — Wayfinding had no entitlement gate before this migration, so every tenant that could
-- already use it must not silently lose it the moment enforcement ships. WAYFINDING_AI,
-- ROOM_BOOKING, and INDOOR_POSITIONING are new/unreleased modules and are deliberately left
-- unassigned. Safe to re-run: does nothing on an empty (dev) database, since the SELECT simply
-- returns no rows.
--
-- IDs use md5(random()...), the same convention as the 20260824090100 data migration, rather
-- than gen_random_uuid()/pgcrypto, to avoid depending on a Postgres extension being installed.
INSERT INTO "TenantModule" (id, "moduleKey", status, "enabledAt", "createdAt", "updatedAt", "organizationId")
SELECT
  md5(random()::text || clock_timestamp()::text || o.id || ':wayfinding-backfill'),
  'WAYFINDING',
  'ACTIVE',
  now(),
  now(),
  now(),
  o.id
FROM "Organization" o;
