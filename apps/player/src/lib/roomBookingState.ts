import type { RoomBookingPlayerPayload } from '@lumina/types';

export interface DisplayReservation {
  id: string;
  startsAt: string;
  endsAt: string;
  title: string | null;
  organizerDisplayName: string | null;
}

export type RoomDisplayState =
  | { kind: 'AVAILABLE'; availableUntil: string | null }
  | { kind: 'STARTING_SOON'; nextReservation: DisplayReservation }
  | { kind: 'OCCUPIED'; currentReservation: DisplayReservation }
  | { kind: 'OUT_OF_SERVICE' }
  | { kind: 'STALE'; lastGeneratedAt: string };

// docs/modules/room_booking_module_plan.md §10.2 — a pure function so the status transitions
// (available -> starting soon -> occupied -> available) are unit-testable without a running
// player, a network call, or a device clock. `now` is always derived from a server-time offset
// captured from the latest payload (see computeServerOffsetMs below), never the raw device clock.
export function resolveRoomDisplayState(
  now: Date,
  reservations: DisplayReservation[],
  startingSoonMinutes: number,
  roomStatus: 'ACTIVE' | 'OUT_OF_SERVICE',
): RoomDisplayState {
  if (roomStatus === 'OUT_OF_SERVICE') return { kind: 'OUT_OF_SERVICE' };

  const nowMs = now.getTime();
  // Half-open [startsAt, endsAt) — a meeting ending exactly now is no longer "current," matching
  // the server's own booking-conflict semantics (room_booking_module_plan.md §3.8).
  const current = reservations.find((r) => new Date(r.startsAt).getTime() <= nowMs && nowMs < new Date(r.endsAt).getTime());
  if (current) return { kind: 'OCCUPIED', currentReservation: current };

  const upcoming = reservations
    .filter((r) => new Date(r.startsAt).getTime() > nowMs)
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  const next = upcoming[0];

  if (next && new Date(next.startsAt).getTime() - nowMs <= startingSoonMinutes * 60_000) {
    return { kind: 'STARTING_SOON', nextReservation: next };
  }
  return { kind: 'AVAILABLE', availableUntil: next?.startsAt ?? null };
}

// §10.2/§10.3 — the offset between the device clock and the server clock as of the latest
// payload, applied to every subsequent local recompute so transitions stay accurate even on a
// kiosk with a wrong/drifting device clock, without polling the network every second.
export function computeServerOffsetMs(payload: RoomBookingPlayerPayload): number {
  return new Date(payload.serverNow).getTime() - Date.now();
}

// §10.3 — never show a cached room as certainly available past its freshness window; STALE wins
// over whatever resolveRoomDisplayState would otherwise compute.
export function isPayloadStale(payload: RoomBookingPlayerPayload, now: Date, freshnessThresholdMs: number): boolean {
  return now.getTime() - new Date(payload.generatedAt).getTime() > freshnessThresholdMs;
}
