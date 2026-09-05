import { Injectable, InternalServerErrorException, Optional } from '@nestjs/common';
import type { RoomCalendarProviderKey } from '@lumina/types';
import { NativeCalendarProvider } from './native-calendar.provider';
import type { RoomCalendarProvider } from './room-calendar-provider';
import { Microsoft365CalendarProvider } from '../integrations/microsoft365/microsoft365-calendar.provider';

// docs/modules/room_booking_module_plan.md §5.1 — rooms within one tenant can each have a
// different providerKey, so RoomBookingService dispatches per-room rather than depending on one
// injected provider. Connector providers are optionally injected (never a hard compile-time
// requirement) so the core module still boots with no connector milestone enabled — Nest's DI
// resolves `@Optional()` to `undefined` rather than failing when Microsoft365Module isn't
// imported, e.g. in a deployment that never selected that connector milestone.
@Injectable()
export class RoomCalendarProviderRegistry {
  private readonly providers = new Map<RoomCalendarProviderKey, RoomCalendarProvider>();

  constructor(
    nativeProvider: NativeCalendarProvider,
    @Optional() microsoft365Provider?: Microsoft365CalendarProvider,
  ) {
    this.register(nativeProvider);
    if (microsoft365Provider) this.register(microsoft365Provider);
  }

  register(provider: RoomCalendarProvider): void {
    this.providers.set(provider.key, provider);
  }

  get(key: RoomCalendarProviderKey): RoomCalendarProvider {
    const provider = this.providers.get(key);
    if (!provider) {
      throw new InternalServerErrorException(`No Room Booking provider registered for ${key} — its connector milestone may not be enabled on this deployment`);
    }
    return provider;
  }

  isAvailable(key: RoomCalendarProviderKey): boolean {
    return this.providers.has(key);
  }
}
