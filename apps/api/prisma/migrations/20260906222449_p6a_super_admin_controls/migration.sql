-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "suspensionReason" TEXT;

-- AlterTable
ALTER TABLE "PlatformAuditLog" ADD COLUMN     "ipAddress" TEXT,
ADD COLUMN     "reason" TEXT,
ADD COLUMN     "result" TEXT NOT NULL DEFAULT 'success',
ADD COLUMN     "userAgent" TEXT;
