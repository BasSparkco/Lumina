import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { RoomBookingService } from './room-booking.service';
import { RoomPlayerStateService } from './room-player-state.service';
import { BookNowDto } from './dto/book-now.dto';
import { PlayerJwtGuard } from '../../common/guards/player-jwt.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { ScreenJwtUser } from '../../common/types/jwt-user';
import { PrismaService } from '../../prisma/prisma.service';

// docs/modules/room_booking_module_plan.md §8.4 — the server derives the room from the
// authenticated screen binding; the request body cannot specify organizationId/roomId/start
// time/organizer/another screen. Throttled tightly per screen so repeated taps/network retries
// can't hammer the exclusion constraint — actual duplicate-prevention is the idempotency key
// handled in RoomBookingService.bookNow, this is just the burst guard.
@ApiTags('room-booking')
@Controller('player/room-booking')
export class RoomBookingPlayerController {
  constructor(
    private readonly roomBooking: RoomBookingService,
    private readonly playerState: RoomPlayerStateService,
    private readonly prisma: PrismaService,
  ) {}

  @UseGuards(PlayerJwtGuard)
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @Post('book-now')
  async bookNow(@CurrentUser() screen: ScreenJwtUser, @Body() dto: BookNowDto) {
    await this.roomBooking.bookNow(screen.sub, dto.durationMinutes, dto.idempotencyKey);

    const binding = await this.prisma.roomDisplayBinding.findUnique({ where: { screenId: screen.sub } });
    const payload = binding ? await this.playerState.buildPayload(binding) : null;
    return { payload };
  }
}
