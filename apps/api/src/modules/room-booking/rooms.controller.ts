import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RoomBookingService } from './room-booking.service';
import { CreateRoomDto } from './dto/create-room.dto';
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
@Controller('rooms')
export class RoomsController {
  constructor(private readonly roomBooking: RoomBookingService) {}

  @Get()
  list(@CurrentUser() user: JwtUser) {
    return this.roomBooking.listRooms(user.orgId);
  }

  @Post()
  create(@CurrentUser() user: JwtUser, @Body() dto: CreateRoomDto) {
    return this.roomBooking.createRoom(user.orgId, dto, user.sub);
  }

  @Get(':roomId')
  get(@CurrentUser() user: JwtUser, @Param('roomId') roomId: string) {
    return this.roomBooking.getRoom(user.orgId, roomId);
  }

  @Put(':roomId')
  update(@CurrentUser() user: JwtUser, @Param('roomId') roomId: string, @Body() dto: CreateRoomDto) {
    return this.roomBooking.updateRoom(user.orgId, roomId, dto, user.sub);
  }

  @Delete(':roomId')
  remove(@CurrentUser() user: JwtUser, @Param('roomId') roomId: string) {
    return this.roomBooking.deleteRoom(user.orgId, roomId, user.sub);
  }

  @Get(':roomId/availability')
  availability(
    @CurrentUser() user: JwtUser,
    @Param('roomId') roomId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.roomBooking.getRoomAvailability(user.orgId, roomId, new Date(from), new Date(to));
  }
}
