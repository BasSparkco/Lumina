-- CreateEnum
CREATE TYPE "BookableRoomStatus" AS ENUM ('ACTIVE', 'OUT_OF_SERVICE');

-- CreateEnum
CREATE TYPE "RoomPrivacyMode" AS ENUM ('SHOW_TITLE', 'SHOW_ORGANIZER', 'BUSY_ONLY');

-- CreateEnum
CREATE TYPE "RoomCalendarProviderKey" AS ENUM ('LUMINA', 'MICROSOFT_365', 'GOOGLE_WORKSPACE');

-- CreateEnum
CREATE TYPE "RoomReservationStatus" AS ENUM ('CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RoomReservationOrigin" AS ENUM ('DASHBOARD', 'KIOSK', 'EXTERNAL_SYNC');

-- AlterEnum
ALTER TYPE "StreamingType" ADD VALUE 'ROOM_BOOKING';

-- CreateTable
CREATE TABLE "BookableRoom" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "locationLabel" TEXT,
    "timezone" TEXT NOT NULL,
    "capacity" INTEGER,
    "amenities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "BookableRoomStatus" NOT NULL DEFAULT 'ACTIVE',
    "privacyMode" "RoomPrivacyMode" NOT NULL DEFAULT 'BUSY_ONLY',
    "providerKey" "RoomCalendarProviderKey" NOT NULL DEFAULT 'LUMINA',
    "externalResourceId" TEXT,
    "externalResourceEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "calendarConnectionId" TEXT,
    "wayfindingPoiId" TEXT,

    CONSTRAINT "BookableRoom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomDisplayBinding" (
    "id" TEXT NOT NULL,
    "quickBookingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "quickBookingDurationsMinutes" INTEGER[] DEFAULT ARRAY[15, 30, 60]::INTEGER[],
    "startingSoonMinutes" INTEGER NOT NULL DEFAULT 10,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "screenId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,

    CONSTRAINT "RoomDisplayBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomReservation" (
    "id" TEXT NOT NULL,
    "title" TEXT,
    "organizerDisplayName" TEXT,
    "startsAt" TIMESTAMPTZ NOT NULL,
    "endsAt" TIMESTAMPTZ NOT NULL,
    "status" "RoomReservationStatus" NOT NULL DEFAULT 'CONFIRMED',
    "providerKey" "RoomCalendarProviderKey" NOT NULL,
    "origin" "RoomReservationOrigin" NOT NULL,
    "externalEventId" TEXT,
    "providerExternalKey" TEXT,
    "externalICalUid" TEXT,
    "externalEtag" TEXT,
    "providerUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "roomId" TEXT NOT NULL,
    "createdByUserId" TEXT,

    CONSTRAINT "RoomReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomCalendarConnection" (
    "id" TEXT NOT NULL,
    "providerKey" "RoomCalendarProviderKey" NOT NULL,
    "displayName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "encryptedCredential" BYTEA,
    "externalTenantId" TEXT,
    "lastSuccessfulSyncAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "webhookSubscriptionId" TEXT,
    "webhookExpiresAt" TIMESTAMP(3),
    "syncCursor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "RoomCalendarConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookableRoom_organizationId_status_idx" ON "BookableRoom"("organizationId", "status");

-- CreateIndex
CREATE INDEX "BookableRoom_calendarConnectionId_idx" ON "BookableRoom"("calendarConnectionId");

-- CreateIndex
CREATE UNIQUE INDEX "BookableRoom_organizationId_normalizedName_key" ON "BookableRoom"("organizationId", "normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "RoomDisplayBinding_screenId_key" ON "RoomDisplayBinding"("screenId");

-- CreateIndex
CREATE INDEX "RoomDisplayBinding_roomId_idx" ON "RoomDisplayBinding"("roomId");

-- CreateIndex
CREATE UNIQUE INDEX "RoomReservation_providerExternalKey_key" ON "RoomReservation"("providerExternalKey");

-- CreateIndex
CREATE INDEX "RoomReservation_roomId_startsAt_endsAt_idx" ON "RoomReservation"("roomId", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "RoomReservation_roomId_providerKey_idx" ON "RoomReservation"("roomId", "providerKey");

-- CreateIndex
CREATE INDEX "RoomReservation_externalICalUid_idx" ON "RoomReservation"("externalICalUid");

-- CreateIndex
CREATE INDEX "RoomCalendarConnection_organizationId_providerKey_idx" ON "RoomCalendarConnection"("organizationId", "providerKey");

-- AddForeignKey
ALTER TABLE "BookableRoom" ADD CONSTRAINT "BookableRoom_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookableRoom" ADD CONSTRAINT "BookableRoom_calendarConnectionId_fkey" FOREIGN KEY ("calendarConnectionId") REFERENCES "RoomCalendarConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookableRoom" ADD CONSTRAINT "BookableRoom_wayfindingPoiId_fkey" FOREIGN KEY ("wayfindingPoiId") REFERENCES "Poi"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomDisplayBinding" ADD CONSTRAINT "RoomDisplayBinding_screenId_fkey" FOREIGN KEY ("screenId") REFERENCES "Screen"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomDisplayBinding" ADD CONSTRAINT "RoomDisplayBinding_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "BookableRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomReservation" ADD CONSTRAINT "RoomReservation_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "BookableRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomReservation" ADD CONSTRAINT "RoomReservation_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomCalendarConnection" ADD CONSTRAINT "RoomCalendarConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- docs/modules/room_booking_module_plan.md §7.3 — atomic non-overlap protection for Lumina-native
-- confirmed reservations, enforced at the database level rather than relying on application-level
-- locking (which is race-prone under concurrent Book Now taps/dashboard writes). Prisma schema
-- syntax cannot express EXCLUDE USING gist, so this constraint is hand-written here; the model
-- above only declares the plain columns/indexes it needs. Scoped to CONFIRMED + LUMINA rows only:
-- CANCELLED rows and externally-sourced rows are explicitly allowed to "overlap" (a cancelled
-- meeting freeing the slot, or a provider legitimately returning overlapping events) without
-- weakening the guarantee that matters — two native bookings can never both hold the same room
-- for overlapping time. A violation surfaces as a Postgres exclusion-violation error (SQLSTATE
-- 23P01), which the service layer translates into HTTP 409 with the latest availability.
-- Requires startsAt/endsAt to be genuine TIMESTAMPTZ (see the model comment) — tstzrange() over
-- an implicitly-cast naive timestamp is not IMMUTABLE and Postgres refuses to index it.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "RoomReservation"
  ADD CONSTRAINT "RoomReservation_no_overlap_native_confirmed"
  EXCLUDE USING gist (
    "roomId" WITH =,
    tstzrange("startsAt", "endsAt", '[)') WITH &&
  )
  WHERE (status = 'CONFIRMED' AND "providerKey" = 'LUMINA');
