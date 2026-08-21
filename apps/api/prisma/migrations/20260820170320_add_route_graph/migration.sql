-- CreateEnum
CREATE TYPE "RouteEdgeType" AS ENUM ('WALK', 'ELEVATOR', 'ESCALATOR', 'STAIRS');

-- CreateTable
CREATE TABLE "RouteNode" (
    "id" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "label" TEXT,
    "floorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RouteNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouteEdge" (
    "id" TEXT NOT NULL,
    "type" "RouteEdgeType" NOT NULL DEFAULT 'WALK',
    "weight" DOUBLE PRECISION NOT NULL,
    "fromNodeId" TEXT NOT NULL,
    "toNodeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RouteEdge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RouteNode_floorId_idx" ON "RouteNode"("floorId");

-- CreateIndex
CREATE INDEX "RouteEdge_fromNodeId_idx" ON "RouteEdge"("fromNodeId");

-- CreateIndex
CREATE INDEX "RouteEdge_toNodeId_idx" ON "RouteEdge"("toNodeId");

-- AddForeignKey
ALTER TABLE "RouteNode" ADD CONSTRAINT "RouteNode_floorId_fkey" FOREIGN KEY ("floorId") REFERENCES "Floor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteEdge" ADD CONSTRAINT "RouteEdge_fromNodeId_fkey" FOREIGN KEY ("fromNodeId") REFERENCES "RouteNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteEdge" ADD CONSTRAINT "RouteEdge_toNodeId_fkey" FOREIGN KEY ("toNodeId") REFERENCES "RouteNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
