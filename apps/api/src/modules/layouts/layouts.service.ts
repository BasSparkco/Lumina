import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateLayoutDto } from './dto/create-layout.dto';

@Injectable()
export class LayoutsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(orgId: string, dto: CreateLayoutDto) {
    return this.prisma.layout.create({
      data: {
        name: dto.name,
        organizationId: orgId,
        zones: {
          create: dto.zones.map(z => ({
            name: z.name,
            x: z.x,
            y: z.y,
            width: z.width,
            height: z.height,
            zIndex: z.zIndex ?? 0,
            zoneType: z.zoneType ?? 'MEDIA',
            ...(z.widgetConfig ? { widgetConfig: z.widgetConfig as object } : {}),
            playlistId: z.playlistId,
          })),
        },
      },
      include: { zones: { include: { playlist: { select: { id: true, name: true } } } } },
    });
  }

  async list(orgId: string) {
    return this.prisma.layout.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
      include: {
        zones: { include: { playlist: { select: { id: true, name: true } } } },
        _count: { select: { screens: true } },
      },
    });
  }

  async findOne(orgId: string, id: string) {
    const layout = await this.prisma.layout.findFirst({
      where: { id, organizationId: orgId },
      include: { zones: { include: { playlist: { select: { id: true, name: true } } } } },
    });
    if (!layout) throw new NotFoundException('Layout not found');
    return layout;
  }

  async update(orgId: string, id: string, dto: CreateLayoutDto) {
    await this.findOne(orgId, id);

    // Replace all zones atomically
    await this.prisma.zone.deleteMany({ where: { layoutId: id } });

    return this.prisma.layout.update({
      where: { id },
      data: {
        name: dto.name,
        zones: {
          create: dto.zones.map(z => ({
            name: z.name,
            x: z.x,
            y: z.y,
            width: z.width,
            height: z.height,
            zIndex: z.zIndex ?? 0,
            zoneType: z.zoneType ?? 'MEDIA',
            ...(z.widgetConfig ? { widgetConfig: z.widgetConfig as object } : {}),
            playlistId: z.playlistId,
          })),
        },
      },
      include: { zones: { include: { playlist: { select: { id: true, name: true } } } } },
    });
  }

  async remove(orgId: string, id: string) {
    await this.findOne(orgId, id);
    await this.prisma.layout.delete({ where: { id } });
  }
}
