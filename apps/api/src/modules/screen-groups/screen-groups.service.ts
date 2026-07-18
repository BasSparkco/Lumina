import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ScreenGateway } from '../ws/screen.gateway';

@Injectable()
export class ScreenGroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: ScreenGateway,
  ) {}

  async create(orgId: string, name: string) {
    return this.prisma.screenGroup.create({ data: { name, organizationId: orgId } });
  }

  async list(orgId: string) {
    return this.prisma.screenGroup.findMany({
      where: { organizationId: orgId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { screens: true } } },
    });
  }

  async findOne(orgId: string, id: string) {
    const group = await this.prisma.screenGroup.findFirst({
      where: { id, organizationId: orgId },
      include: { screens: { select: { id: true, name: true, status: true } } },
    });
    if (!group) throw new NotFoundException('Screen group not found');
    return group;
  }

  async rename(orgId: string, id: string, name: string) {
    await this.assertOwns(orgId, id);
    return this.prisma.screenGroup.update({ where: { id }, data: { name } });
  }

  async remove(orgId: string, id: string) {
    await this.assertOwns(orgId, id);
    await this.prisma.screenGroup.delete({ where: { id } });
  }

  async bulkPublish(orgId: string, id: string) {
    const group = await this.findOne(orgId, id);
    for (const screen of group.screens) {
      this.gateway.sendToScreen(screen.id, { type: 'publish' });
    }
    return { ok: true, screenCount: group.screens.length };
  }

  async setVolume(orgId: string, id: string, volume: number | null) {
    const group = await this.findOne(orgId, id);
    const clamped = volume === null ? null : Math.max(0, Math.min(100, Math.round(volume)));
    const updated = await this.prisma.screenGroup.update({ where: { id }, data: { volume: clamped } });
    // Push an immediate refresh to member screens without their own override, rather than
    // waiting up to 60s for the player's next poll (same rationale as bulkPublish).
    for (const screen of group.screens) {
      this.gateway.sendToScreen(screen.id, { type: 'publish' });
    }
    return updated;
  }

  private async assertOwns(orgId: string, id: string) {
    const group = await this.prisma.screenGroup.findFirst({ where: { id, organizationId: orgId } });
    if (!group) throw new NotFoundException('Screen group not found');
    return group;
  }
}
