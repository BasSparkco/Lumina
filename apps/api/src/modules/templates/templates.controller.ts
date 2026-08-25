import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { TemplatesService } from './templates.service';
import { TemplateDto, TenantAccessDto } from './dto/template.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';
import { RequireSuperAdmin } from '../../common/decorators/require-super-admin.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUser } from '../../common/types/jwt-user';

// designer.md §10.1/§21 "Templates — Super Admin". SuperAdminGuard must run after JwtAuthGuard
// (see its own doc comment) so req.user is populated before it checks isSuperAdmin.
@ApiTags('admin/templates')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, SuperAdminGuard)
@RequireSuperAdmin()
@Controller('admin/templates')
export class AdminTemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get()
  list() {
    return this.templates.adminList();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.templates.adminGet(id);
  }

  @Post()
  create(@Body() dto: TemplateDto) {
    return this.templates.adminCreate(dto);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: TemplateDto) {
    return this.templates.adminUpdate(id, dto);
  }

  @Post(':id/publish')
  publish(@Param('id') id: string) {
    return this.templates.adminPublish(id);
  }

  @Post(':id/unpublish')
  unpublish(@Param('id') id: string) {
    return this.templates.adminUnpublish(id);
  }

  @Delete(':id')
  archive(@Param('id') id: string) {
    return this.templates.adminArchive(id);
  }

  @Get(':id/tenant-access')
  getTenantAccess(@Param('id') id: string) {
    return this.templates.adminGetTenantAccess(id);
  }

  @Put(':id/tenant-access')
  setTenantAccess(@Param('id') id: string, @Body() dto: TenantAccessDto) {
    return this.templates.adminSetTenantAccess(id, dto);
  }
}

// designer.md §21 "Templates — Customer". No @Roles() override — RolesGuard's default (VIEWER/
// LIBRARY_MANAGER read-only) already matches designer.md §25's intent that every editing role,
// but not a pure viewer, may customize an authorized template into their own DesignAsset.
@ApiTags('templates')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get()
  list(@CurrentUser() user: JwtUser) {
    return this.templates.customerList(user.orgId);
  }

  @Get(':id')
  get(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.templates.customerGet(user.orgId, id);
  }

  @Post(':id/create-design')
  createDesign(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.templates.createDesign(user.orgId, id);
  }
}
