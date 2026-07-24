import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ThemesService } from './themes.service';
import { ThemeDto } from './dto/theme.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUser } from '../../common/types/jwt-user';

@ApiTags('themes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('themes')
export class ThemesController {
  constructor(private readonly themes: ThemesService) {}

  @Post()
  create(@CurrentUser() user: JwtUser, @Body() dto: ThemeDto) {
    return this.themes.create(user.orgId, dto);
  }

  @Get()
  list(@CurrentUser() user: JwtUser) {
    return this.themes.list(user.orgId);
  }

  @Get(':id')
  findOne(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.themes.findOne(user.orgId, id);
  }

  @Put(':id')
  update(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: ThemeDto) {
    return this.themes.update(user.orgId, id, dto);
  }

  @Post(':id/duplicate')
  duplicate(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.themes.duplicate(user.orgId, id);
  }

  @Delete(':id')
  remove(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.themes.remove(user.orgId, id);
  }
}
