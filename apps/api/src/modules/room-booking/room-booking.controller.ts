import { Body, Controller, Delete, Get, Param, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RoomBookingService } from './room-booking.service';
import { UpdateDisplayBindingDto } from './dto/update-display-binding.dto';
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
@Controller('room-booking')
export class RoomBookingController {
  constructor(private readonly roomBooking: RoomBookingService) {}

  @Get('displays')
  listDisplays(@CurrentUser() user: JwtUser) {
    return this.roomBooking.listDisplays(user.orgId);
  }

  @Put('displays/:screenId')
  updateDisplay(@CurrentUser() user: JwtUser, @Param('screenId') screenId: string, @Body() dto: UpdateDisplayBindingDto) {
    return this.roomBooking.updateDisplayBinding(user.orgId, screenId, dto, user.sub);
  }

  @Delete('displays/:screenId')
  removeDisplay(@CurrentUser() user: JwtUser, @Param('screenId') screenId: string) {
    return this.roomBooking.removeDisplayBinding(user.orgId, screenId, user.sub);
  }
}
