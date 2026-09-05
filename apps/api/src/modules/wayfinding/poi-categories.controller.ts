import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { PoiCategoriesService } from './poi-categories.service';
import { CreatePoiCategoryDto } from './dto/create-poi-category.dto';
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
@Controller('poi-categories')
export class PoiCategoriesController {
  constructor(private readonly categories: PoiCategoriesService) {}

  @Get()
  list(@CurrentUser() user: JwtUser) {
    return this.categories.list(user.orgId);
  }

  @Post()
  create(@CurrentUser() user: JwtUser, @Body() dto: CreatePoiCategoryDto) {
    return this.categories.create(user.orgId, dto);
  }

  @Put(':id')
  update(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: CreatePoiCategoryDto) {
    return this.categories.update(user.orgId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.categories.remove(user.orgId, id);
  }
}
