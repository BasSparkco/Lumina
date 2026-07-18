import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ScreenGroupsService } from './screen-groups.service';
import { CreateScreenGroupDto } from './dto/create-screen-group.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUser } from '../../common/types/jwt-user';

@ApiTags('screen-groups')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('screen-groups')
export class ScreenGroupsController {
  constructor(private readonly groups: ScreenGroupsService) {}

  @Post()
  create(@CurrentUser() user: JwtUser, @Body() dto: CreateScreenGroupDto) {
    return this.groups.create(user.orgId, dto.name);
  }

  @Get()
  list(@CurrentUser() user: JwtUser) {
    return this.groups.list(user.orgId);
  }

  @Get(':id')
  findOne(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.groups.findOne(user.orgId, id);
  }

  @Put(':id')
  rename(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: CreateScreenGroupDto) {
    return this.groups.rename(user.orgId, id, dto.name);
  }

  @Delete(':id')
  remove(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.groups.remove(user.orgId, id);
  }

  @Post(':id/publish')
  bulkPublish(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.groups.bulkPublish(user.orgId, id);
  }

  @Put(':id/volume')
  setVolume(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: { volume: number | null }) {
    return this.groups.setVolume(user.orgId, id, dto.volume);
  }
}
