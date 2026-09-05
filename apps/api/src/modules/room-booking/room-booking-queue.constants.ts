// Shared Redis-backed BullMQ queue name — apps/api only ever produces to this queue (the public
// Microsoft 365 webhook controller enqueues a reconciliation job here); apps/worker is the
// consumer, same producer/consumer split already established for the 'media' queue between
// assets.controller.ts and apps/worker's MediaProcessor. Keep this string literal identical to
// apps/worker's own local constant — the two apps don't share a common TS module, exactly like
// the existing 'media' queue convention.
export const ROOM_BOOKING_SYNC_QUEUE = 'room-booking-sync';
