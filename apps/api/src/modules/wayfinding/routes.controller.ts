import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { RoutesService } from './routes.service';
import { CreateRouteNodeDto } from './dto/create-route-node.dto';
import { CreateRouteEdgeDto } from './dto/create-route-edge.dto';
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
export class RoutesController {
  constructor(private readonly routes: RoutesService) {}

  @Get('buildings/:buildingId/route-graph')
  graph(@CurrentUser() user: JwtUser, @Param('buildingId') buildingId: string) {
    return this.routes.graph(user.orgId, buildingId);
  }

  @Post('floors/:floorId/route-nodes')
  createNode(@CurrentUser() user: JwtUser, @Param('floorId') floorId: string, @Body() dto: CreateRouteNodeDto) {
    return this.routes.createNode(user.orgId, floorId, dto);
  }

  @Put('route-nodes/:id')
  updateNode(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: CreateRouteNodeDto) {
    return this.routes.updateNode(user.orgId, id, dto);
  }

  @Delete('route-nodes/:id')
  removeNode(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.routes.removeNode(user.orgId, id);
  }

  @Post('buildings/:buildingId/route-edges')
  createEdge(@CurrentUser() user: JwtUser, @Param('buildingId') buildingId: string, @Body() dto: CreateRouteEdgeDto) {
    return this.routes.createEdge(user.orgId, buildingId, dto);
  }

  @Put('route-edges/:id')
  updateEdge(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: CreateRouteEdgeDto) {
    return this.routes.updateEdge(user.orgId, id, dto);
  }

  @Delete('route-edges/:id')
  removeEdge(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.routes.removeEdge(user.orgId, id);
  }
}
