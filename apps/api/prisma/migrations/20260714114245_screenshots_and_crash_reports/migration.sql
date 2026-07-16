-- AlterTable
ALTER TABLE "Screen" ADD COLUMN     "screenshotUpdatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CrashReport" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "stackTrace" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "screenId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "CrashReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrashReport_organizationId_screenId_occurredAt_idx" ON "CrashReport"("organizationId", "screenId", "occurredAt");

-- AddForeignKey
ALTER TABLE "CrashReport" ADD CONSTRAINT "CrashReport_screenId_fkey" FOREIGN KEY ("screenId") REFERENCES "Screen"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrashReport" ADD CONSTRAINT "CrashReport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
