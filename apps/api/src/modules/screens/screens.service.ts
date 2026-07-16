import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ScreenGateway } from '../ws/screen.gateway';
import type { CreateScreenDto } from './dto/create-screen.dto';

const CRASH_ROLLUP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class ScreensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly gateway: ScreenGateway,
    private readonly storage: StorageService,
  ) {}

  private withScreenshotUrl<T extends { id: string; organizationId: string | null; screenshotUpdatedAt: Date | null }>(screen: T) {
    return {
      ...screen,
      screenshotUrl: screen.screenshotUpdatedAt && screen.organizationId
        ? this.storage.publicUrl(this.storage.screenshotKey(screen.organizationId, screen.id))
        : null,
    };
  }

  async create(orgId: string, dto: CreateScreenDto) {
    return this.prisma.screen.create({
      data: {
        name: dto.name,
        timezone: dto.timezone ?? 'UTC',
        organizationId: orgId,
      },
    });
  }

  async list(orgId: string) {
    const screens = await this.prisma.screen.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
      include: { playlist: { select: { id: true, name: true } } },
    });
    return screens.map(s => this.withScreenshotUrl(s));
  }

  async findOne(orgId: string, id: string) {
    const screen = await this.prisma.screen.findFirst({
      where: { id, organizationId: orgId },
      include: { playlist: { select: { id: true, name: true } } },
    });
    if (!screen) throw new NotFoundException('Screen not found');
    return this.withScreenshotUrl(screen);
  }

  async remove(orgId: string, id: string) {
    const screen = await this.findOne(orgId, id);
    if (screen.screenshotUpdatedAt) await this.storage.delete(this.storage.screenshotKey(orgId, id));
    await this.prisma.screen.delete({ where: { id } });
  }

  async rename(orgId: string, id: string, name: string) {
    await this.findOne(orgId, id);
    return this.prisma.screen.update({ where: { id }, data: { name } });
  }

  async assignPlaylist(orgId: string, screenId: string, playlistId: string) {
    const screen = await this.findOne(orgId, screenId);
    const playlist = await this.prisma.playlist.findFirst({ where: { id: playlistId, organizationId: orgId } });
    if (!playlist) throw new NotFoundException('Playlist not found');
    if (playlist.approvalStatus !== 'APPROVED') {
      throw new BadRequestException('Only approved playlists can be assigned to a screen');
    }
    const updated = await this.prisma.screen.update({ where: { id: screen.id }, data: { playlistId } });
    this.gateway.sendToScreen(screenId, { type: 'publish' });
    return updated;
  }

  async publishToScreen(orgId: string, screenId: string) {
    await this.findOne(orgId, screenId);
    this.gateway.sendToScreen(screenId, { type: 'publish' });
    return { ok: true };
  }

  async reloadScreen(orgId: string, screenId: string) {
    await this.findOne(orgId, screenId);
    this.gateway.sendToScreen(screenId, { type: 'reload' });
    return { ok: true };
  }

  async captureScreenshot(orgId: string, screenId: string) {
    await this.findOne(orgId, screenId);
    this.gateway.sendToScreen(screenId, { type: 'capture-screenshot' });
    return { ok: true };
  }

  async crashReports(orgId: string, screenId: string) {
    await this.findOne(orgId, screenId);
    return this.prisma.crashReport.findMany({
      where: { screenId, organizationId: orgId },
      orderBy: { occurredAt: 'desc' },
      take: 20,
    });
  }

  async setEmergency(orgId: string, screenId: string, active: boolean, playlistId?: string) {
    await this.findOne(orgId, screenId);
    if (playlistId) {
      const pl = await this.prisma.playlist.findFirst({ where: { id: playlistId, organizationId: orgId } });
      if (!pl) throw new NotFoundException('Playlist not found');
    }
    const updated = await this.prisma.screen.update({
      where: { id: screenId },
      data: { emergencyActive: active, ...(playlistId ? { emergencyPlaylistId: playlistId } : {}) },
    });
    this.gateway.sendToScreen(screenId, { type: 'publish' });
    return updated;
  }

  async setStopped(orgId: string, screenId: string, stopped: boolean) {
    await this.findOne(orgId, screenId);
    const updated = await this.prisma.screen.update({ where: { id: screenId }, data: { stopped } });
    this.gateway.sendToScreen(screenId, { type: 'publish' });
    return updated;
  }

  async updatePrayerConfig(
    orgId: string,
    screenId: string,
    dto: { latitude?: number; longitude?: number; prayerMethod?: string; athanEnabled?: boolean; timezone?: string },
  ) {
    await this.findOne(orgId, screenId);
    return this.prisma.screen.update({
      where: { id: screenId },
      data: {
        ...(dto.latitude !== undefined ? { latitude: dto.latitude } : {}),
        ...(dto.longitude !== undefined ? { longitude: dto.longitude } : {}),
        ...(dto.prayerMethod !== undefined ? { prayerMethod: dto.prayerMethod } : {}),
        ...(dto.athanEnabled !== undefined ? { athanEnabled: dto.athanEnabled } : {}),
        ...(dto.timezone !== undefined ? { timezone: dto.timezone } : {}),
      },
    });
  }

  async setLayout(orgId: string, screenId: string, layoutId: string | null) {
    await this.findOne(orgId, screenId);
    if (layoutId) {
      const layout = await this.prisma.layout.findFirst({ where: { id: layoutId, organizationId: orgId } });
      if (!layout) throw new NotFoundException('Layout not found');
    }
    const updated = await this.prisma.screen.update({
      where: { id: screenId },
      data: { layoutId },
    });
    this.gateway.sendToScreen(screenId, { type: 'publish' });
    return updated;
  }

  async setGroup(orgId: string, screenId: string, groupId: string | null) {
    await this.findOne(orgId, screenId);
    if (groupId) {
      const group = await this.prisma.screenGroup.findFirst({ where: { id: groupId, organizationId: orgId } });
      if (!group) throw new NotFoundException('Screen group not found');
    }
    return this.prisma.screen.update({ where: { id: screenId }, data: { groupId } });
  }

  async fleetStatus(orgId: string) {
    const screens = await this.prisma.screen.findMany({
      where: { organizationId: orgId },
      orderBy: { name: 'asc' },
      include: {
        alerts: { where: { resolvedAt: null }, orderBy: { createdAt: 'desc' } },
      },
    });

    const crashCounts = await this.prisma.crashReport.groupBy({
      by: ['screenId'],
      where: { organizationId: orgId, occurredAt: { gte: new Date(Date.now() - CRASH_ROLLUP_WINDOW_MS) } },
      _count: { id: true },
    });
    const crashCountByScreen = Object.fromEntries(crashCounts.map(c => [c.screenId, c._count.id]));

    const now = Date.now();
    const items = screens.map(s => ({
      id: s.id,
      name: s.name,
      status: s.status,
      lastSeenAt: s.lastSeenAt,
      offlineForMs: s.status === 'OFFLINE' && s.lastSeenAt ? now - s.lastSeenAt.getTime() : null,
      alerts: s.alerts,
      crashCount7d: crashCountByScreen[s.id] ?? 0,
    }));

    return {
      total: items.length,
      online: items.filter(i => i.status === 'ONLINE').length,
      offline: items.filter(i => i.status === 'OFFLINE').length,
      screens: items,
    };
  }

  // Dashboard: confirm a pairing code → associates screen with org, returns screen
  async confirmPairing(orgId: string, code: string) {
    const screen = await this.prisma.screen.findUnique({ where: { pairingCode: code } });
    if (!screen) throw new BadRequestException('Invalid or expired pairing code');
    if (screen.paired) throw new BadRequestException('Screen already paired');

    const token = this.jwt.sign(
      { sub: screen.id, orgId, type: 'screen' },
      { expiresIn: '10y' },
    );

    // Give still-default-named screens a running serial ("Unnamed Screen 3") instead of a
    // bare, indistinguishable "Unnamed Screen" — based on how many screens this org already
    // has, so the number reflects the order they were added in even once some get renamed.
    const name = screen.name === 'Unnamed Screen'
      ? `Unnamed Screen ${(await this.prisma.screen.count({ where: { organizationId: orgId } })) + 1}`
      : screen.name;

    return this.prisma.screen.update({
      where: { id: screen.id },
      data: { paired: true, pairingCode: null, playerToken: token, organizationId: orgId, name },
    });
  }
}
