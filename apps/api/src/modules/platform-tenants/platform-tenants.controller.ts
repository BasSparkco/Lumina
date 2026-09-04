import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PlatformTenantsService } from './platform-tenants.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantStatusDto } from './dto/update-tenant-status.dto';
import { SetTenantModulesDto } from './dto/set-tenant-modules.dto';
import { OwnerInviteDto } from './dto/owner-invite.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';
import { RequireSuperAdmin } from '../../common/decorators/require-super-admin.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUser } from '../../common/types/jwt-user';

// Every route here targets a tenant OTHER than the caller's own (the Super Admin's own orgId is
// never substituted for :tenantId, per Section 9.2 of the ADR) — deliberately not gated by
// EntitlementGuard, which only ever checks the caller's own organization.
@ApiTags('admin/tenants')
@ApiBearerAuth()
@Controller('admin/tenants')
@UseGuards(JwtAuthGuard, SuperAdminGuard)
@RequireSuperAdmin()
export class PlatformTenantsController {
  constructor(private readonly tenants: PlatformTenantsService) {}

  @Get()
  list() {
    return this.tenants.list();
  }

  @Get(':tenantId')
  detail(@Param('tenantId') tenantId: string) {
    return this.tenants.detail(tenantId);
  }

  @Post()
  create(@CurrentUser() user: JwtUser, @Body() dto: CreateTenantDto) {
    return this.tenants.create(
      {
        name: dto.name,
        slug: dto.slug,
        ownerEmail: dto.ownerEmail,
        modules: dto.modules.map((m) => ({ key: m.key, status: m.status, expiresAt: m.expiresAt ? new Date(m.expiresAt) : null })),
      },
      user.sub,
    );
  }

  @Put(':tenantId/status')
  updateStatus(@CurrentUser() user: JwtUser, @Param('tenantId') tenantId: string, @Body() dto: UpdateTenantStatusDto) {
    return this.tenants.updateStatus(tenantId, dto.status, user.sub);
  }

  @Put(':tenantId/modules')
  setModules(@CurrentUser() user: JwtUser, @Param('tenantId') tenantId: string, @Body() dto: SetTenantModulesDto) {
    return this.tenants.setModules(
      tenantId,
      dto.assignments.map((m) => ({ key: m.key, status: m.status, expiresAt: m.expiresAt ? new Date(m.expiresAt) : null })),
      user.sub,
    );
  }

  @Post(':tenantId/owner-invite')
  reissueOwnerInvite(@CurrentUser() user: JwtUser, @Param('tenantId') tenantId: string, @Body() dto: OwnerInviteDto) {
    return this.tenants.reissueOwnerInvite(tenantId, dto.email, user.sub);
  }
}
