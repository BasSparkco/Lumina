import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Microsoft365ConnectionsService } from './microsoft365-connections.service';
import { ConnectMicrosoft365Dto } from './dto/connect-microsoft365.dto';
import { MapRoomDto } from './dto/map-room.dto';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../../common/guards/roles.guard';
import { EntitlementGuard } from '../../../entitlements/entitlement.guard';
import { RequireModule } from '../../../entitlements/require-module.decorator';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import type { JwtUser } from '../../../../common/types/jwt-user';

// docs/modules/room_booking_module_plan.md §11.2 "Integrations" dashboard section — implemented
// only for the Microsoft 365 connector milestone; the section itself may stay hidden in the
// dashboard until a connector is actually enabled (§4.2).
@ApiTags('room-booking')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, EntitlementGuard)
@RequireModule('ROOM_BOOKING')
@Controller('room-booking/integrations/microsoft365')
export class Microsoft365ConnectionsController {
  constructor(private readonly connections: Microsoft365ConnectionsService) {}

  @Get('connections')
  list(@CurrentUser() user: JwtUser) {
    return this.connections.listConnections(user.orgId);
  }

  @Post('connections')
  connect(@CurrentUser() user: JwtUser, @Body() dto: ConnectMicrosoft365Dto) {
    return this.connections.connect(user.orgId, dto, user.sub);
  }

  @Delete('connections/:connectionId')
  disconnect(@CurrentUser() user: JwtUser, @Param('connectionId') connectionId: string) {
    return this.connections.disconnect(user.orgId, connectionId, user.sub);
  }

  @Get('connections/:connectionId/rooms')
  listMappableRooms(@CurrentUser() user: JwtUser, @Param('connectionId') connectionId: string) {
    return this.connections.listMappableRooms(user.orgId, connectionId);
  }

  @Post('rooms/:roomId/map')
  mapRoom(@CurrentUser() user: JwtUser, @Param('roomId') roomId: string, @Body() dto: MapRoomDto) {
    return this.connections.mapRoom(user.orgId, roomId, dto.connectionId, dto.externalResourceId, dto.externalResourceEmail, user.sub);
  }

  @Post('rooms/:roomId/subscribe')
  async subscribeRoom(@CurrentUser() user: JwtUser, @Param('roomId') roomId: string) {
    return this.connections.subscribeRoomWebhook(user.orgId, roomId);
  }
}
