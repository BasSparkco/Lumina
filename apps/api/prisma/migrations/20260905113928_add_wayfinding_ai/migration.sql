-- CreateTable
CREATE TABLE "PoiAlias" (
    "id" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "normalizedValue" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "poiId" TEXT NOT NULL,

    CONSTRAINT "PoiAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WayfindingAiScreenConfig" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "welcomeMessage" TEXT NOT NULL DEFAULT 'How can I help you find your destination?',
    "welcomeMessageAr" TEXT NOT NULL DEFAULT 'كيف يمكنني مساعدتك في العثور على وجهتك؟',
    "maxTurns" INTEGER NOT NULL DEFAULT 8,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "screenId" TEXT NOT NULL,

    CONSTRAINT "WayfindingAiScreenConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WayfindingAiUsageLog" (
    "id" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "latencyMs" INTEGER NOT NULL,
    "usedModel" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organizationId" TEXT NOT NULL,
    "screenId" TEXT NOT NULL,
    "resolvedPoiId" TEXT,

    CONSTRAINT "WayfindingAiUsageLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PoiAlias_normalizedValue_idx" ON "PoiAlias"("normalizedValue");

-- CreateIndex
CREATE UNIQUE INDEX "PoiAlias_poiId_language_normalizedValue_key" ON "PoiAlias"("poiId", "language", "normalizedValue");

-- CreateIndex
CREATE UNIQUE INDEX "WayfindingAiScreenConfig_screenId_key" ON "WayfindingAiScreenConfig"("screenId");

-- CreateIndex
CREATE INDEX "WayfindingAiUsageLog_organizationId_createdAt_idx" ON "WayfindingAiUsageLog"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "WayfindingAiUsageLog_screenId_createdAt_idx" ON "WayfindingAiUsageLog"("screenId", "createdAt");

-- AddForeignKey
ALTER TABLE "PoiAlias" ADD CONSTRAINT "PoiAlias_poiId_fkey" FOREIGN KEY ("poiId") REFERENCES "Poi"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WayfindingAiScreenConfig" ADD CONSTRAINT "WayfindingAiScreenConfig_screenId_fkey" FOREIGN KEY ("screenId") REFERENCES "Screen"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WayfindingAiUsageLog" ADD CONSTRAINT "WayfindingAiUsageLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WayfindingAiUsageLog" ADD CONSTRAINT "WayfindingAiUsageLog_screenId_fkey" FOREIGN KEY ("screenId") REFERENCES "Screen"("id") ON DELETE CASCADE ON UPDATE CASCADE;
