import type { RoomCalendarProviderKey } from '@lumina/types';

// docs/modules/room_booking_module_plan.md §5.1 — provider-neutral domain contract. Controllers
// and RoomBookingService depend on this interface (and the ROOM_CALENDAR_PROVIDER_REGISTRY
// injection token) only; neither ever contains Microsoft Graph or Google Calendar request logic.

export interface ProviderRoomRef {
  id: string;
  externalResourceId: string | null;
  externalResourceEmail: string | null;
  calendarConnectionId: string | null;
}

export interface NormalizedReservation {
  externalEventId: string;
  externalICalUid: string | null;
  externalEtag: string | null;
  startsAt: Date;
  endsAt: Date;
  title: string | null;
  organizerDisplayName: string | null;
  status: 'CONFIRMED' | 'CANCELLED';
  providerUpdatedAt: Date | null;
}

export interface ProviderListInput {
  room: ProviderRoomRef;
  from: Date;
  to: Date;
}

export interface ProviderCreateInput {
  room: ProviderRoomRef;
  startsAt: Date;
  endsAt: Date;
  title?: string | null;
  organizerDisplayName?: string | null;
  idempotencyKey: string;
}

export interface ProviderCancelInput {
  room: ProviderRoomRef;
  externalEventId: string;
}

export type ProviderHealthStatus = 'HEALTHY' | 'DEGRADED' | 'ERROR' | 'NOT_CONNECTED';

export interface ProviderHealth {
  status: ProviderHealthStatus;
  lastSuccessfulSyncAt: Date | null;
  lastErrorCode: string | null;
}

export interface RoomCalendarProvider {
  readonly key: RoomCalendarProviderKey;
  listReservations(input: ProviderListInput): Promise<NormalizedReservation[]>;
  createReservation(input: ProviderCreateInput): Promise<NormalizedReservation>;
  cancelReservation?(input: ProviderCancelInput): Promise<void>;
  healthCheck(connectionId: string | null): Promise<ProviderHealth>;
}

// Thrown by any provider (native or external) to report a booking-time conflict — the service
// layer translates this into HTTP 409 with the latest availability, never a generic 500.
export class RoomBookingConflictError extends Error {
  constructor(message = 'The room is no longer available for the requested time') {
    super(message);
  }
}

export const ROOM_CALENDAR_PROVIDER_REGISTRY = Symbol('ROOM_CALENDAR_PROVIDER_REGISTRY');
