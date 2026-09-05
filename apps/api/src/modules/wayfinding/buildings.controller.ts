import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { BuildingsService } from './buildings.service';
import { CreateBuildingDto } from './dto/create-building.dto';
import { CreateFloorDto } from './dto/create-floor.dto';
import { SetEvacuationDto } from './dto/set-evacuation.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { EntitlementGuard } from '../entitlements/entitlement.guard';
import { RequireModule } from '../entitlements/require-module.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUser } from '../../common/types/jwt-user';

@ApiTags('wayfinding')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, EntitlementGuard)
@RequireModule('WAYFINDING')
@Controller()
export class BuildingsController {
  constructor(private readonly buildings: BuildingsService) {}

  @Post('buildings')
  create(@CurrentUser() user: JwtUser, @Body() dto: CreateBuildingDto) {
    return this.buildings.create(user.orgId, dto);
  }

  @Get('buildings')
  list(@CurrentUser() user: JwtUser) {
    return this.buildings.list(user.orgId);
  }

  @Get('buildings/:id')
  findOne(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.buildings.findOne(user.orgId, id);
  }

  @Put('buildings/:id')
  update(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: CreateBuildingDto) {
    return this.buildings.update(user.orgId, id, dto);
  }

  @Delete('buildings/:id')
  remove(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.buildings.remove(user.orgId, id);
  }

  @Put('buildings/:id/evacuation')
  setEvacuation(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: SetEvacuationDto) {
    return this.buildings.setEvacuation(user.orgId, id, dto.active);
  }

  @Post('buildings/:id/sync-screen-group')
  syncScreenGroup(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.buildings.syncScreenGroup(user.orgId, id);
  }

  @Post('buildings/:buildingId/floors')
  createFloor(@CurrentUser() user: JwtUser, @Param('buildingId') buildingId: string, @Body() dto: CreateFloorDto) {
    return this.buildings.createFloor(user.orgId, buildingId, dto);
  }

  @Put('floors/:id')
  updateFloor(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: CreateFloorDto) {
    return this.buildings.updateFloor(user.orgId, id, dto);
  }

  @Delete('floors/:id')
  removeFloor(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.buildings.removeFloor(user.orgId, id);
  }
}
