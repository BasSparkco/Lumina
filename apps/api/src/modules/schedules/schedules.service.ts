import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateScheduleDto } from './dto/create-schedule.dto';
import type { Schedule } from '@prisma/client';

@Injectable()
export class SchedulesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(orgId: string, dto: CreateScheduleDto) {
    // Verify screen + playlist belong to this org
    await this.assertScreenOwned(orgId, dto.screenId);
    await this.assertPlaylistOwned(orgId, dto.playlistId);

    return this.prisma.schedule.create({
      data: {
        name: dto.name,
        priority: dto.priority ?? 0,
        startTime: dto.startTime ?? null,
        endTime: dto.endTime ?? null,
        daysOfWeek: dto.daysOfWeek ?? [],
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        playlistId: dto.playlistId,
        screenId: dto.screenId,
        organizationId: orgId,
      },
      include: { playlist: { select: { id: true, name: true } } },
    });
  }

  async list(orgId: string, screenId?: string) {
    return this.prisma.schedule.findMany({
      where: { organizationId: orgId, ...(screenId ? { screenId } : {}) },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      include: { playlist: { select: { id: true, name: true } } },
    });
  }

  async findOne(orgId: string, id: string) {
    const s = await this.prisma.schedule.findFirst({
      where: { id, organizationId: orgId },
      include: { playlist: { select: { id: true, name: true } } },
    });
    if (!s) throw new NotFoundException('Schedule not found');
    return s;
  }

  async update(orgId: string, id: string, dto: CreateScheduleDto) {
    await this.findOne(orgId, id);
    if (dto.playlistId) await this.assertPlaylistOwned(orgId, dto.playlistId);

    return this.prisma.schedule.update({
      where: { id },
      data: {
        name: dto.name,
        priority: dto.priority ?? 0,
        startTime: dto.startTime ?? null,
        endTime: dto.endTime ?? null,
        daysOfWeek: dto.daysOfWeek ?? [],
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        playlistId: dto.playlistId,
      },
      include: { playlist: { select: { id: true, name: true } } },
    });
  }

  async remove(orgId: string, id: string) {
    await this.findOne(orgId, id);
    await this.prisma.schedule.delete({ where: { id } });
  }

  /** Returns the playlistId that should play right now for a given screen, or null. */
  resolveNow(rules: Schedule[], now: Date): string | null {
    const day = now.getDay();
    const hhmm = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    const matching = rules
      .filter(r => {
        if (r.startDate && now < r.startDate) return false;
        if (r.endDate && now > r.endDate) return false;
        if (r.daysOfWeek.length > 0 && !r.daysOfWeek.includes(day)) return false;

        if (r.startTime && r.endTime) {
          // Handle spans that cross midnight (e.g. 22:00–06:00)
          if (r.startTime <= r.endTime) {
            if (hhmm < r.startTime || hhmm >= r.endTime) return false;
          } else {
            if (hhmm < r.startTime && hhmm >= r.endTime) return false;
          }
        }
        return true;
      })
      .sort((a, b) => b.priority - a.priority);

    return matching[0]?.playlistId ?? null;
  }

  async getSchedulesForScreen(screenId: string): Promise<Schedule[]> {
    return this.prisma.schedule.findMany({
      where: { screenId },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });
  }

  private async assertScreenOwned(orgId: string, screenId: string) {
    const screen = await this.prisma.screen.findFirst({ where: { id: screenId, organizationId: orgId } });
    if (!screen) throw new NotFoundException('Screen not found');
  }

  private async assertPlaylistOwned(orgId: string, playlistId: string) {
    const pl = await this.prisma.playlist.findFirst({ where: { id: playlistId, organizationId: orgId } });
    if (!pl) throw new NotFoundException('Playlist not found');
  }
}
