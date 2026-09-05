import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { PoisService } from './pois.service';
import { CreatePoiDto } from './dto/create-poi.dto';
import { ImportPoisDto } from './dto/import-pois.dto';
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
export class PoisController {
  constructor(private readonly pois: PoisService) {}

  @Get('floors/:floorId/pois')
  list(@CurrentUser() user: JwtUser, @Param('floorId') floorId: string) {
    return this.pois.list(user.orgId, floorId);
  }

  @Post('floors/:floorId/pois')
  create(@CurrentUser() user: JwtUser, @Param('floorId') floorId: string, @Body() dto: CreatePoiDto) {
    return this.pois.create(user.orgId, floorId, dto);
  }

  @Post('floors/:floorId/pois/import')
  import(@CurrentUser() user: JwtUser, @Param('floorId') floorId: string, @Body() dto: ImportPoisDto) {
    return this.pois.import(user.orgId, floorId, dto);
  }

  @Put('pois/:id')
  update(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: CreatePoiDto) {
    return this.pois.update(user.orgId, id, dto);
  }

  @Delete('pois/:id')
  remove(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.pois.remove(user.orgId, id);
  }
}
