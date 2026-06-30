import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { LayoutsService } from './layouts.service';
import { CreateLayoutDto } from './dto/create-layout.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUser } from '../../common/types/jwt-user';

@ApiTags('layouts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('layouts')
export class LayoutsController {
  constructor(private readonly layouts: LayoutsService) {}

  @Post()
  create(@CurrentUser() user: JwtUser, @Body() dto: CreateLayoutDto) {
    return this.layouts.create(user.orgId, dto);
  }

  @Get()
  list(@CurrentUser() user: JwtUser) {
    return this.layouts.list(user.orgId);
  }

  @Get(':id')
  findOne(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.layouts.findOne(user.orgId, id);
  }

  @Put(':id')
  update(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: CreateLayoutDto) {
    return this.layouts.update(user.orgId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.layouts.remove(user.orgId, id);
  }
}
