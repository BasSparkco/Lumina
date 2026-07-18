import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { PowerSchedulesService } from './power-schedules.service';
import { CreatePowerScheduleDto } from './dto/create-power-schedule.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUser } from '../../common/types/jwt-user';

@ApiTags('power-schedules')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('power-schedules')
export class PowerSchedulesController {
  constructor(private readonly powerSchedules: PowerSchedulesService) {}

  @Post()
  create(@CurrentUser() user: JwtUser, @Body() dto: CreatePowerScheduleDto) {
    return this.powerSchedules.create(user.orgId, dto);
  }

  @Get()
  list(@CurrentUser() user: JwtUser, @Query('screenId') screenId?: string, @Query('groupId') groupId?: string) {
    return this.powerSchedules.list(user.orgId, screenId, groupId);
  }

  // Registered before ':id' so 'preview' isn't swallowed by the param route.
  @Get('preview')
  preview(@CurrentUser() user: JwtUser, @Query('screenId') screenId: string) {
    return this.powerSchedules.previewNow(user.orgId, screenId);
  }

  @Get(':id')
  findOne(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.powerSchedules.findOne(user.orgId, id);
  }

  @Put(':id')
  update(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: CreatePowerScheduleDto) {
    return this.powerSchedules.update(user.orgId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.powerSchedules.remove(user.orgId, id);
  }
}
