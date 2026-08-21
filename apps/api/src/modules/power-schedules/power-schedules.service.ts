import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OrgScopedService } from '../../common/org-scoped.service';
import type { CreatePowerScheduleDto } from './dto/create-power-schedule.dto';
import type { PowerSchedule, Screen } from '@lumina/db';

const DAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

@Injectable()
export class PowerSchedulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgScoped: OrgScopedService,
  ) {}

  async create(orgId: string, dto: CreatePowerScheduleDto) {
    await this.assertOneTarget(orgId, dto.screenId, dto.groupId);

    return this.prisma.powerSchedule.create({
      data: {
        daysOfWeek: dto.daysOfWeek ?? [],
        startTime: dto.startTime,
        endTime: dto.endTime,
        screenId: dto.screenId ?? null,
        groupId: dto.groupId ?? null,
        organizationId: orgId,
      },
      include: { screen: { select: { id: true, name: true } }, group: { select: { id: true, name: true } } },
    });
  }

  async list(orgId: string, screenId?: string, groupId?: string) {
    return this.prisma.powerSchedule.findMany({
      where: { organizationId: orgId, ...(screenId ? { screenId } : {}), ...(groupId ? { groupId } : {}) },
      orderBy: { createdAt: 'asc' },
      include: { screen: { select: { id: true, name: true } }, group: { select: { id: true, name: true } } },
    });
  }

  async findOne(orgId: string, id: string) {
    return this.orgScoped.assertOwns(
      () => this.prisma.powerSchedule.findFirst({
        where: { id, organizationId: orgId },
        include: { screen: { select: { id: true, name: true } }, group: { select: { id: true, name: true } } },
      }),
      'Power schedule not found',
    );
  }

  async update(orgId: string, id: string, dto: CreatePowerScheduleDto) {
    await this.findOne(orgId, id);
    await this.assertOneTarget(orgId, dto.screenId, dto.groupId);

    return this.prisma.powerSchedule.update({
      where: { id },
      data: {
        daysOfWeek: dto.daysOfWeek ?? [],
        startTime: dto.startTime,
        endTime: dto.endTime,
        screenId: dto.screenId ?? null,
        groupId: dto.groupId ?? null,
      },
      include: { screen: { select: { id: true, name: true } }, group: { select: { id: true, name: true } } },
    });
  }

  async remove(orgId: string, id: string) {
    await this.findOne(orgId, id);
    await this.prisma.powerSchedule.delete({ where: { id } });
  }

  /** Screen-level rules take precedence over the screen's group's rules — a screen with its own
   * power schedule ignores the group's entirely rather than merging the two rule sets. A screen
   * with no rules anywhere (screen or group) is always considered on, i.e. the feature is unset. */
  async resolveForScreen(screen: Screen): Promise<{ poweredOn: boolean; rules: PowerSchedule[] }> {
    let rules = await this.prisma.powerSchedule.findMany({ where: { screenId: screen.id } });
    if (rules.length === 0 && screen.groupId) {
      rules = await this.prisma.powerSchedule.findMany({ where: { groupId: screen.groupId } });
    }
    if (rules.length === 0) return { poweredOn: true, rules: [] };

    return { poweredOn: this.matchesNow(rules, new Date(), screen.timezone), rules };
  }

  async previewNow(orgId: string, screenId: string) {
    const screen = await this.orgScoped.assertOwns(
      () => this.prisma.screen.findFirst({ where: { id: screenId, organizationId: orgId } }),
      'Screen not found',
    );
    const { poweredOn } = await this.resolveForScreen(screen);
    return { poweredOn };
  }

  /** Same Intl-based local weekday/HH:MM resolution as SchedulesService.resolveNow, but a plain
   * OR across all rules — there's no "which one wins," just "is any window open right now." */
  private matchesNow(rules: PowerSchedule[], now: Date, timezone: string): boolean {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
    const weekday = parts.find(p => p.type === 'weekday')?.value ?? 'Sun';
    const hour = parts.find(p => p.type === 'hour')?.value ?? '00';
    const minute = parts.find(p => p.type === 'minute')?.value ?? '00';
    const day = DAY_INDEX[weekday] ?? 0;
    const hhmm = `${hour}:${minute}`;

    return rules.some(r => {
      if (r.daysOfWeek.length > 0 && !r.daysOfWeek.includes(day)) return false;

      // Handle windows that cross midnight (e.g. 22:00-06:00)
      if (r.startTime <= r.endTime) {
        return hhmm >= r.startTime && hhmm < r.endTime;
      }
      return hhmm >= r.startTime || hhmm < r.endTime;
    });
  }

  private async assertOneTarget(orgId: string, screenId?: string, groupId?: string) {
    if (!!screenId === !!groupId) {
      throw new BadRequestException('Exactly one of screenId or groupId must be set');
    }
    if (screenId) {
      await this.orgScoped.assertOwns(
        () => this.prisma.screen.findFirst({ where: { id: screenId, organizationId: orgId } }),
        'Screen not found',
      );
    }
    if (groupId) {
      await this.orgScoped.assertOwns(
        () => this.prisma.screenGroup.findFirst({ where: { id: groupId, organizationId: orgId } }),
        'Screen group not found',
      );
    }
  }
}
