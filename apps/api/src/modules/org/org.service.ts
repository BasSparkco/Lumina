import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash } from 'bcryptjs';
import type { UserRole } from '@lumina/db';
import { PrismaService } from '../../prisma/prisma.service';
import { OrgScopedService } from '../../common/org-scoped.service';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class OrgService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly orgScoped: OrgScopedService,
  ) {}

  async listMembers(orgId: string) {
    return this.prisma.user.findMany({
      where: { organizationId: orgId },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async listInvites(orgId: string) {
    return this.prisma.orgInvite.findMany({
      where: { organizationId: orgId, acceptedAt: null },
      select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async invite(orgId: string, email: string, role: UserRole) {
    const existingUser = await this.prisma.user.findFirst({ where: { organizationId: orgId, email } });
    if (existingUser) throw new ConflictException('That email is already a member of this organization');

    // No email delivery is wired up yet — the token is returned directly so the dashboard can
    // show/copy an invite link. Swap for a real email send without changing this shape.
    const invite = await this.prisma.orgInvite.create({
      data: {
        email,
        role,
        organizationId: orgId,
        token: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      },
    });
    return invite;
  }

  async acceptInvite(token: string, name: string, password: string) {
    const invite = await this.prisma.orgInvite.findUnique({ where: { token } });
    if (invite?.acceptedAt !== null || invite.expiresAt < new Date()) {
      throw new UnauthorizedException('Invite is invalid or has expired');
    }

    const existingUser = await this.prisma.user.findUnique({ where: { email: invite.email } });
    if (existingUser) throw new ConflictException('Email already in use');

    const [user] = await this.prisma.$transaction([
      this.prisma.user.create({
        data: {
          email: invite.email,
          passwordHash: await hash(password, 12),
          name,
          role: invite.role,
          organizationId: invite.organizationId,
        },
      }),
      this.prisma.orgInvite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } }),
    ]);

    const jwtToken = this.jwt.sign({ sub: user.id, orgId: user.organizationId, role: user.role });
    return { token: jwtToken, user: { id: user.id, email: user.email, name: user.name, role: user.role, orgId: user.organizationId } };
  }

  async updateMemberRole(orgId: string, memberId: string, role: UserRole) {
    const member = await this.getMember(orgId, memberId);

    if (member.role === 'OWNER' && role !== 'OWNER') {
      await this.assertNotLastOwner(orgId, memberId);
    }

    return this.prisma.user.update({
      where: { id: memberId },
      data: { role },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });
  }

  async removeMember(orgId: string, memberId: string, requestingUserId: string) {
    if (memberId === requestingUserId) throw new BadRequestException("You can't remove yourself");

    const member = await this.getMember(orgId, memberId);
    if (member.role === 'OWNER') await this.assertNotLastOwner(orgId, memberId);

    await this.prisma.user.delete({ where: { id: memberId } });
  }

  async getSettings(orgId: string) {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId }, select: { autoPublish: true } });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  async updateSettings(orgId: string, autoPublish: boolean) {
    return this.prisma.organization.update({ where: { id: orgId }, data: { autoPublish }, select: { autoPublish: true } });
  }

  private async getMember(orgId: string, memberId: string) {
    return this.orgScoped.assertOwns(
      () => this.prisma.user.findFirst({ where: { id: memberId, organizationId: orgId } }),
      'Member not found',
    );
  }

  private async assertNotLastOwner(orgId: string, excludingMemberId: string) {
    const otherOwners = await this.prisma.user.count({
      where: { organizationId: orgId, role: 'OWNER', id: { not: excludingMemberId } },
    });
    if (otherOwners === 0) throw new BadRequestException('An organization must keep at least one owner');
  }
}
