-- AlterTable
ALTER TABLE "Screen" ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Screen_organizationId_sortOrder_idx" ON "Screen"("organizationId", "sortOrder");
