import type { RoomBookingPlayerPayload } from '@lumina/types';
import { api, ApiError } from './api';

// docs/modules/room_booking_module_plan.md §8.4/§10.3 — "apply a tight per-screen throttle and
// idempotency storage so repeated taps or network retries do not create duplicates." The
// idempotency key is generated once per *attempt* and reused across retries of that same
// attempt (network hiccup, tap-again-before-response) — a fresh key is only ever minted for a
// deliberately new booking request, never for retrying the current one.
export class RoomBookingClient {
  private pendingKey: string | null = null;

  async bookNow(durationMinutes: number): Promise<{ payload: RoomBookingPlayerPayload | null }> {
    this.pendingKey ??= crypto.randomUUID();
    try {
      const result = await api.bookNowRoom(durationMinutes, this.pendingKey);
      this.pendingKey = null; // success — the next tap is a genuinely new booking attempt
      return result;
    } catch (err) {
      // Keep the same key so a retry of *this* failed attempt stays idempotent; a 4xx (policy
      // rejection, e.g. duration not approved) is not retryable with the same inputs, so clear it.
      if (err instanceof ApiError && err.status < 500) this.pendingKey = null;
      throw err;
    }
  }
}
