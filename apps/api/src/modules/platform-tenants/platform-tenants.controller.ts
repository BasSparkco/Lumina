import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PlatformTenantsService, type AuditContext } from './platform-tenants.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantStatusDto } from './dto/update-tenant-status.dto';
import { UpdateTenantNameDto } from './dto/update-tenant-name.dto';
import { SetTenantModulesDto } from './dto/set-tenant-modules.dto';
import { OwnerInviteDto } from './dto/owner-invite.dto';
import { UpdateMemberRoleDto } from '../org/dto/update-member-role.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';
import { RequireSuperAdmin } from '../../common/decorators/require-super-admin.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUser } from '../../common/types/jwt-user';

// P6a (docs/tenant_isolation_and_platform_admin_plan.md §"Platform audit") — every mutating route
// below passes this down to PlatformTenantsService so PlatformAuditLog's ipAddress/userAgent
// columns are populated consistently, the same way every route already threads through actorUserId.
function auditContext(req: Request): AuditContext {
  return { ipAddress: req.ip, userAgent: req.get('user-agent') ?? undefined };
}

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
  create(@CurrentUser() user: JwtUser, @Body() dto: CreateTenantDto, @Req() req: Request) {
    return this.tenants.create(
      {
        name: dto.name,
        slug: dto.slug,
        ownerEmail: dto.ownerEmail,
        modules: dto.modules.map((m) => ({ key: m.key, status: m.status, expiresAt: m.expiresAt ? new Date(m.expiresAt) : null })),
      },
      user.sub,
      auditContext(req),
    );
  }

  @Put(':tenantId/name')
  updateName(@CurrentUser() user: JwtUser, @Param('tenantId') tenantId: string, @Body() dto: UpdateTenantNameDto, @Req() req: Request) {
    return this.tenants.updateName(tenantId, dto.name, user.sub, auditContext(req));
  }

  @Put(':tenantId/status')
  updateStatus(@CurrentUser() user: JwtUser, @Param('tenantId') tenantId: string, @Body() dto: UpdateTenantStatusDto, @Req() req: Request) {
    return this.tenants.updateStatus(tenantId, dto.status, user.sub, dto.reason, auditContext(req));
  }

  @Put(':tenantId/modules')
  setModules(@CurrentUser() user: JwtUser, @Param('tenantId') tenantId: string, @Body() dto: SetTenantModulesDto, @Req() req: Request) {
    return this.tenants.setModules(
      tenantId,
      dto.assignments.map((m) => ({ key: m.key, status: m.status, expiresAt: m.expiresAt ? new Date(m.expiresAt) : null })),
      user.sub,
      auditContext(req),
    );
  }

  @Post(':tenantId/owner-invite')
  reissueOwnerInvite(@CurrentUser() user: JwtUser, @Param('tenantId') tenantId: string, @Body() dto: OwnerInviteDto, @Req() req: Request) {
    return this.tenants.reissueOwnerInvite(tenantId, dto.email, user.sub, auditContext(req));
  }

  @Delete(':tenantId/owner-invite/:inviteId')
  revokeOwnerInvite(@CurrentUser() user: JwtUser, @Param('tenantId') tenantId: string, @Param('inviteId') inviteId: string, @Req() req: Request) {
    return this.tenants.revokeOwnerInvite(tenantId, inviteId, user.sub, auditContext(req));
  }

  @Get(':tenantId/members')
  listMembers(@Param('tenantId') tenantId: string) {
    return this.tenants.listMembers(tenantId);
  }

  @Get(':tenantId/invites')
  listInvites(@Param('tenantId') tenantId: string) {
    return this.tenants.listInvites(tenantId);
  }

  @Put(':tenantId/members/:memberId/role')
  updateMemberRole(
    @CurrentUser() user: JwtUser,
    @Param('tenantId') tenantId: string,
    @Param('memberId') memberId: string,
    @Body() dto: UpdateMemberRoleDto,
    @Req() req: Request,
  ) {
    return this.tenants.updateMemberRole(tenantId, memberId, dto.role, user.sub, auditContext(req));
  }

  @Delete(':tenantId/members/:memberId')
  removeMember(@CurrentUser() user: JwtUser, @Param('tenantId') tenantId: string, @Param('memberId') memberId: string, @Req() req: Request) {
    return this.tenants.removeMember(tenantId, memberId, user.sub, auditContext(req));
  }

  @Post(':tenantId/members/:memberId/revoke-sessions')
  revokeMemberSessions(
    @CurrentUser() user: JwtUser,
    @Param('tenantId') tenantId: string,
    @Param('memberId') memberId: string,
    @Req() req: Request,
  ) {
    return this.tenants.revokeMemberSessions(tenantId, memberId, user.sub, auditContext(req));
  }

  @Post(':tenantId/revoke-sessions')
  revokeAllSessions(@CurrentUser() user: JwtUser, @Param('tenantId') tenantId: string, @Req() req: Request) {
    return this.tenants.revokeAllSessions(tenantId, user.sub, auditContext(req));
  }

  @Get(':tenantId/audit')
  listAuditLog(@Param('tenantId') tenantId: string, @Query('limit') limit?: string) {
    return this.tenants.listAuditLog(tenantId, limit ? Number(limit) : undefined);
  }
}
