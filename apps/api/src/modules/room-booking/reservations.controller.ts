import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RoomBookingService } from './room-booking.service';
import { CreateReservationDto, UpdateReservationDto } from './dto/reservation.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { EntitlementGuard } from '../entitlements/entitlement.guard';
import { RequireModule } from '../entitlements/require-module.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUser } from '../../common/types/jwt-user';

@ApiTags('room-booking')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, EntitlementGuard)
@RequireModule('ROOM_BOOKING')
@Controller('rooms/:roomId/reservations')
export class ReservationsController {
  constructor(private readonly roomBooking: RoomBookingService) {}

  @Get()
  list(@CurrentUser() user: JwtUser, @Param('roomId') roomId: string, @Query('from') from: string, @Query('to') to: string) {
    return this.roomBooking.listReservations(user.orgId, roomId, new Date(from), new Date(to));
  }

  @Post()
  create(@CurrentUser() user: JwtUser, @Param('roomId') roomId: string, @Body() dto: CreateReservationDto) {
    return this.roomBooking.createReservation(user.orgId, roomId, dto, user.sub);
  }

  @Put(':reservationId')
  update(
    @CurrentUser() user: JwtUser,
    @Param('roomId') roomId: string,
    @Param('reservationId') reservationId: string,
    @Body() dto: UpdateReservationDto,
  ) {
    return this.roomBooking.updateReservation(user.orgId, roomId, reservationId, dto, user.sub);
  }

  @Delete(':reservationId')
  cancel(@CurrentUser() user: JwtUser, @Param('roomId') roomId: string, @Param('reservationId') reservationId: string) {
    return this.roomBooking.cancelReservation(user.orgId, roomId, reservationId, user.sub);
  }
}
