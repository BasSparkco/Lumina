import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { OrgService } from './org.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { InviteMemberDto } from './dto/invite-member.dto';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { UpdateOrgSettingsDto } from './dto/update-org-settings.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequireSuperAdmin } from '../../common/decorators/require-super-admin.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUser } from '../../common/types/jwt-user';

@ApiTags('org')
@Controller('org')
export class OrgController {
  constructor(
    private readonly org: OrgService,
    private readonly entitlements: EntitlementsService,
  ) {}

  // Resolves only the caller's own organization from req.user.orgId — never accepts an
  // organization id from the client — and is always computed live, per
  // docs/adr/platform-modules-and-entitlements.md.
  @Get('capabilities')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  getCapabilities(@CurrentUser() user: JwtUser) {
    return this.entitlements.getCapabilities(user.orgId);
  }

  @Get('all')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @RequireSuperAdmin()
  listAll() {
    return this.org.listAllOrganizations();
  }

  @Get('members')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  listMembers(@CurrentUser() user: JwtUser) {
    return this.org.listMembers(user.orgId);
  }

  @Get('invites')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'ADMIN')
  listInvites(@CurrentUser() user: JwtUser) {
    return this.org.listInvites(user.orgId);
  }

  @Post('invite')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'ADMIN')
  invite(@CurrentUser() user: JwtUser, @Body() dto: InviteMemberDto) {
    return this.org.invite(user.orgId, dto.email, dto.role);
  }

  @Post('invite/accept')
  acceptInvite(@Body() dto: AcceptInviteDto) {
    return this.org.acceptInvite(dto.token, dto.name, dto.password);
  }

  @Put('members/:id/role')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'ADMIN')
  updateMemberRole(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: UpdateMemberRoleDto) {
    return this.org.updateMemberRole(user.orgId, id, dto.role);
  }

  @Delete('members/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'ADMIN')
  removeMember(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.org.removeMember(user.orgId, id, user.sub);
  }

  @Get('settings')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  getSettings(@CurrentUser() user: JwtUser) {
    return this.org.getSettings(user.orgId);
  }

  @Put('settings')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'ADMIN')
  updateSettings(@CurrentUser() user: JwtUser, @Body() dto: UpdateOrgSettingsDto) {
    return this.org.updateSettings(user.orgId, dto.autoPublish);
  }
}
