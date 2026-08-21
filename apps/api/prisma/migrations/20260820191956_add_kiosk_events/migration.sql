-- CreateEnum
CREATE TYPE "KioskEventType" AS ENUM ('SESSION_START', 'SEARCH', 'POI_VIEW');

-- CreateTable
CREATE TABLE "KioskEvent" (
    "id" TEXT NOT NULL,
    "type" "KioskEventType" NOT NULL,
    "query" TEXT,
    "poiId" TEXT,
    "poiName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "screenId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "KioskEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KioskEvent_organizationId_screenId_createdAt_idx" ON "KioskEvent"("organizationId", "screenId", "createdAt");

-- AddForeignKey
ALTER TABLE "KioskEvent" ADD CONSTRAINT "KioskEvent_screenId_fkey" FOREIGN KEY ("screenId") REFERENCES "Screen"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KioskEvent" ADD CONSTRAINT "KioskEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
