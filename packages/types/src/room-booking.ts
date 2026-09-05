import { z } from 'zod';

// Room Booking (docs/modules/room_booking_module_plan.md §6) — the shared player/API boundary
// contract. A dedicated domain, not a reuse of the signage Schedule/Playlist tables (§3.3):
// meeting semantics, conflict rules, and organizer privacy are unrelated to content scheduling.

export const BOOKABLE_ROOM_STATUSES = ['ACTIVE', 'OUT_OF_SERVICE'] as const;
export const BookableRoomStatusSchema = z.enum(BOOKABLE_ROOM_STATUSES);
export type BookableRoomStatus = z.infer<typeof BookableRoomStatusSchema>;

export const ROOM_PRIVACY_MODES = ['SHOW_TITLE', 'SHOW_ORGANIZER', 'BUSY_ONLY'] as const;
export const RoomPrivacyModeSchema = z.enum(ROOM_PRIVACY_MODES);
export type RoomPrivacyMode = z.infer<typeof RoomPrivacyModeSchema>;

export const ROOM_CALENDAR_PROVIDER_KEYS = ['LUMINA', 'MICROSOFT_365', 'GOOGLE_WORKSPACE'] as const;
export const RoomCalendarProviderKeySchema = z.enum(ROOM_CALENDAR_PROVIDER_KEYS);
export type RoomCalendarProviderKey = z.infer<typeof RoomCalendarProviderKeySchema>;

export const ROOM_RESERVATION_STATUSES = ['CONFIRMED', 'CANCELLED'] as const;
export const RoomReservationStatusSchema = z.enum(ROOM_RESERVATION_STATUSES);
export type RoomReservationStatus = z.infer<typeof RoomReservationStatusSchema>;

export const ROOM_RESERVATION_ORIGINS = ['DASHBOARD', 'KIOSK', 'EXTERNAL_SYNC'] as const;
export const RoomReservationOriginSchema = z.enum(ROOM_RESERVATION_ORIGINS);
export type RoomReservationOrigin = z.infer<typeof RoomReservationOriginSchema>;

export const QUICK_BOOKING_DURATIONS_MINUTES = [15, 30, 60, 90, 120] as const;
export const MAX_QUICK_BOOKING_DURATIONS = 5;
export const MIN_ROOM_NAME_LENGTH = 1;
export const MAX_ROOM_NAME_LENGTH = 120;
export const MAX_AMENITIES = 20;

// ── Dashboard-facing room summary/detail ──────────────────────────────────────
export const RoomSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  locationLabel: z.string().nullable(),
  timezone: z.string(),
  capacity: z.number().int().nullable(),
  amenities: z.array(z.string()),
  status: BookableRoomStatusSchema,
  privacyMode: RoomPrivacyModeSchema,
  providerKey: RoomCalendarProviderKeySchema,
  wayfindingPoiId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type RoomSummary = z.infer<typeof RoomSummarySchema>;

export const CreateRoomSchema = z.object({
  name: z.string().min(MIN_ROOM_NAME_LENGTH).max(MAX_ROOM_NAME_LENGTH),
  locationLabel: z.string().max(200).optional(),
  timezone: z.string().min(1),
  capacity: z.int().min(0).max(10000).optional(),
  amenities: z.array(z.string().max(60)).max(MAX_AMENITIES).optional(),
  privacyMode: RoomPrivacyModeSchema.optional(),
  status: BookableRoomStatusSchema.optional(),
  wayfindingPoiId: z.string().nullable().optional(),
});
export type CreateRoomInput = z.infer<typeof CreateRoomSchema>;
export const UpdateRoomSchema = CreateRoomSchema;
export type UpdateRoomInput = z.infer<typeof UpdateRoomSchema>;

// ── Reservations (dashboard-facing; native rooms only for direct create/edit) ─
export const ReservationSchema = z.object({
  id: z.string(),
  roomId: z.string(),
  title: z.string().nullable(),
  organizerDisplayName: z.string().nullable(),
  startsAt: z.string(),
  endsAt: z.string(),
  status: RoomReservationStatusSchema,
  providerKey: RoomCalendarProviderKeySchema,
  origin: RoomReservationOriginSchema,
});
export type Reservation = z.infer<typeof ReservationSchema>;

export const CreateReservationSchema = z.object({
  title: z.string().max(200).optional(),
  organizerDisplayName: z.string().max(200).optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  idempotencyKey: z.string().min(1).max(120).optional(),
});
export type CreateReservationInput = z.infer<typeof CreateReservationSchema>;
export const UpdateReservationSchema = CreateReservationSchema;
export type UpdateReservationInput = z.infer<typeof UpdateReservationSchema>;

export const AvailabilitySchema = z.object({
  roomId: z.string(),
  from: z.string(),
  to: z.string(),
  reservations: z.array(ReservationSchema),
});
export type Availability = z.infer<typeof AvailabilitySchema>;

// ── Display bindings ───────────────────────────────────────────────────────────
export const DisplayBindingSchema = z.object({
  screenId: z.string(),
  screenName: z.string(),
  roomId: z.string().nullable(),
  roomName: z.string().nullable(),
  quickBookingEnabled: z.boolean(),
  quickBookingDurationsMinutes: z.array(z.int().positive()),
  startingSoonMinutes: z.int().positive(),
});
export type DisplayBinding = z.infer<typeof DisplayBindingSchema>;

export const UpdateDisplayBindingSchema = z.object({
  roomId: z.string(),
  quickBookingEnabled: z.boolean(),
  quickBookingDurationsMinutes: z.array(z.int().positive().max(24 * 60)).min(1).max(MAX_QUICK_BOOKING_DURATIONS),
  startingSoonMinutes: z.int().positive().max(120),
});
export type UpdateDisplayBindingInput = z.infer<typeof UpdateDisplayBindingSchema>;

// ── Player payload (§5.2) — bounded, privacy-redacted server-side ─────────────
export const RoomBookingPlayerReservationSchema = z.object({
  id: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  title: z.string().nullable(),
  organizerDisplayName: z.string().nullable(),
  status: z.literal('CONFIRMED'),
});
export type RoomBookingPlayerReservation = z.infer<typeof RoomBookingPlayerReservationSchema>;

export const RoomBookingPlayerPayloadSchema = z.object({
  room: z.object({
    id: z.string(),
    name: z.string(),
    locationLabel: z.string().nullable(),
    timezone: z.string(),
    capacity: z.int().nullable(),
    amenities: z.array(z.string()),
    status: BookableRoomStatusSchema,
  }),
  display: z.object({
    privacyMode: RoomPrivacyModeSchema,
    quickBookingEnabled: z.boolean(),
    quickBookingDurationsMinutes: z.array(z.int()),
    startingSoonMinutes: z.int(),
  }),
  serverNow: z.string(),
  reservations: z.array(RoomBookingPlayerReservationSchema),
  generatedAt: z.string(),
  validUntil: z.string(),
});
export type RoomBookingPlayerPayload = z.infer<typeof RoomBookingPlayerPayloadSchema>;

// ── Book Now (§8.4) ────────────────────────────────────────────────────────────
export const BookNowRequestSchema = z.object({
  durationMinutes: z.int().positive().max(24 * 60),
  idempotencyKey: z.string().min(1).max(120),
});
export type BookNowRequest = z.infer<typeof BookNowRequestSchema>;

export const BookNowResponseSchema = z.object({
  reservation: RoomBookingPlayerReservationSchema,
  payload: RoomBookingPlayerPayloadSchema,
});
export type BookNowResponse = z.infer<typeof BookNowResponseSchema>;

// ── Integration health (never includes secrets) ───────────────────────────────
export const IntegrationHealthSchema = z.object({
  id: z.string(),
  providerKey: RoomCalendarProviderKeySchema,
  displayName: z.string(),
  status: z.string(),
  lastSuccessfulSyncAt: z.string().nullable(),
  lastErrorCode: z.string().nullable(),
  webhookExpiresAt: z.string().nullable(),
  roomCount: z.int(),
});
export type IntegrationHealth = z.infer<typeof IntegrationHealthSchema>;

// ── Player-side status resolver output (§10.2) ─────────────────────────────────
export const ROOM_DISPLAY_STATE_KINDS = ['AVAILABLE', 'STARTING_SOON', 'OCCUPIED', 'OUT_OF_SERVICE', 'STALE'] as const;
