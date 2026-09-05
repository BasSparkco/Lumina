import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WsModule } from '../ws/ws.module';
import { AuditModule } from '../audit/audit.module';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { RoomsController } from './rooms.controller';
import { ReservationsController } from './reservations.controller';
import { RoomBookingController } from './room-booking.controller';
import { RoomBookingPlayerController } from './room-booking-player.controller';
import { RoomBookingService } from './room-booking.service';
import { RoomAvailabilityService } from './room-availability.service';
import { RoomPlayerStateService } from './room-player-state.service';
import { RoomBookingEncryptionService } from './encryption.service';
import { RoomCalendarProviderRegistry } from './providers/room-calendar-provider.registry';
import { NativeCalendarProvider } from './providers/native-calendar.provider';
import { Microsoft365Module } from './integrations/microsoft365/microsoft365.module';

@Module({
  imports: [AuthModule, WsModule, AuditModule, EntitlementsModule, Microsoft365Module],
  controllers: [RoomsController, ReservationsController, RoomBookingController, RoomBookingPlayerController],
  providers: [
    RoomBookingService,
    RoomAvailabilityService,
    RoomPlayerStateService,
    RoomBookingEncryptionService,
    NativeCalendarProvider,
    RoomCalendarProviderRegistry,
  ],
  exports: [RoomBookingService, RoomPlayerStateService, RoomCalendarProviderRegistry, RoomBookingEncryptionService],
})
export class RoomBookingModule {}
