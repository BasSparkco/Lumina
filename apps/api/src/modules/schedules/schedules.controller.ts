import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { SchedulesService } from './schedules.service';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUser } from '../../common/types/jwt-user';

@ApiTags('schedules')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('schedules')
export class SchedulesController {
  constructor(private readonly schedules: SchedulesService) {}

  @Post()
  create(@CurrentUser() user: JwtUser, @Body() dto: CreateScheduleDto) {
    return this.schedules.create(user.orgId, dto);
  }

  @Get()
  list(@CurrentUser() user: JwtUser, @Query('screenId') screenId?: string) {
    return this.schedules.list(user.orgId, screenId);
  }

  @Get(':id')
  findOne(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.schedules.findOne(user.orgId, id);
  }

  @Put(':id')
  update(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: CreateScheduleDto) {
    return this.schedules.update(user.orgId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.schedules.remove(user.orgId, id);
  }
}
