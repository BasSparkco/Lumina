// Mirrors apps/api/src/modules/room-booking/room-booking-queue.constants.ts — queue names are
// plain string literals duplicated per app (see apps/api's assets.controller.ts/'media' queue
// for the established producer/consumer split convention), not shared via a package.
export const ROOM_BOOKING_SYNC_QUEUE = 'room-booking-sync';
