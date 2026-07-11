-- AlterTable
ALTER TABLE "Screen" ADD COLUMN     "groupId" TEXT;

-- CreateTable
CREATE TABLE "ScreenGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "ScreenGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProofOfPlayLog" (
    "id" TEXT NOT NULL,
    "playedAt" TIMESTAMP(3) NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "screenId" TEXT NOT NULL,
    "assetId" TEXT,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "ProofOfPlayLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreenAlert" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "screenId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "ScreenAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProofOfPlayLog_organizationId_screenId_playedAt_idx" ON "ProofOfPlayLog"("organizationId", "screenId", "playedAt");

-- CreateIndex
CREATE INDEX "ScreenAlert_organizationId_resolvedAt_idx" ON "ScreenAlert"("organizationId", "resolvedAt");

-- AddForeignKey
ALTER TABLE "Screen" ADD CONSTRAINT "Screen_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ScreenGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreenGroup" ADD CONSTRAINT "ScreenGroup_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofOfPlayLog" ADD CONSTRAINT "ProofOfPlayLog_screenId_fkey" FOREIGN KEY ("screenId") REFERENCES "Screen"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofOfPlayLog" ADD CONSTRAINT "ProofOfPlayLog_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofOfPlayLog" ADD CONSTRAINT "ProofOfPlayLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreenAlert" ADD CONSTRAINT "ScreenAlert_screenId_fkey" FOREIGN KEY ("screenId") REFERENCES "Screen"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreenAlert" ADD CONSTRAINT "ScreenAlert_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
