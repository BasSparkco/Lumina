import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { OrgService } from './org.service';
import { InviteMemberDto } from './dto/invite-member.dto';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUser } from '../../common/types/jwt-user';

@ApiTags('org')
@Controller('org')
export class OrgController {
  constructor(private readonly org: OrgService) {}

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
}
