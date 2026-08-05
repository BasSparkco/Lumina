import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@lumina/db';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateLayoutDto } from './dto/create-layout.dto';

@Injectable()
export class LayoutsService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly zonesInclude = {
    zones: {
      include: {
        playlist: { select: { id: true, name: true } },
        asset: { select: { id: true, name: true } },
      },
    },
  } as const;

  // A MEDIA zone plays either a playlist or a single asset, never both — and neither DTO field
  // was previously checked for org ownership at all (a pre-existing cross-tenant-write gap: any
  // org could point a zone's playlistId at another org's playlist id and it would silently
  // write). Checked together since both need a DB round-trip either way.
  private async validateZones(orgId: string, zones: CreateLayoutDto['zones']) {
    for (const z of zones) {
      if (z.playlistId && z.assetId) {
        throw new BadRequestException(`Zone "${z.name}" can't play both a playlist and an asset — pick one.`);
      }
      if (z.playlistId) {
        const playlist = await this.prisma.playlist.findFirst({ where: { id: z.playlistId, organizationId: orgId } });
        if (!playlist) throw new NotFoundException(`Playlist not found for zone "${z.name}"`);
      }
      if (z.assetId) {
        const asset = await this.prisma.asset.findFirst({ where: { id: z.assetId, organizationId: orgId } });
        if (!asset) throw new NotFoundException(`Asset not found for zone "${z.name}"`);
        if (asset.status !== 'READY') throw new BadRequestException(`Asset for zone "${z.name}" isn't ready yet`);
      }
    }
  }

  private zoneCreateData(z: CreateLayoutDto['zones'][number]) {
    return {
      name: z.name,
      x: z.x,
      y: z.y,
      width: z.width,
      height: z.height,
      zIndex: z.zIndex ?? 0,
      rotation: z.rotation ?? 0,
      zoneType: z.zoneType ?? 'MEDIA',
      shape: z.shape ?? 'rectangle',
      editable: z.editable ?? true,
      ...(z.widgetConfig ? { widgetConfig: z.widgetConfig as Prisma.InputJsonValue } : {}),
      playlistId: z.playlistId,
      assetId: z.assetId,
      audioPriority: z.audioPriority ?? false,
      audioVolume: z.audioVolume,
      cropZoom: z.cropZoom,
      cropOffsetX: z.cropOffsetX,
      cropOffsetY: z.cropOffsetY,
    };
  }

  async create(orgId: string, dto: CreateLayoutDto) {
    await this.validateZones(orgId, dto.zones);
    return this.prisma.layout.create({
      data: {
        name: dto.name,
        organizationId: orgId,
        zones: { create: dto.zones.map(z => this.zoneCreateData(z)) },
      },
      include: this.zonesInclude,
    });
  }

  async list(orgId: string) {
    return this.prisma.layout.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
      include: { ...this.zonesInclude, _count: { select: { screens: true } } },
    });
  }

  async findOne(orgId: string, id: string) {
    const layout = await this.prisma.layout.findFirst({
      where: { id, organizationId: orgId },
      include: this.zonesInclude,
    });
    if (!layout) throw new NotFoundException('Layout not found');
    return layout;
  }

  async update(orgId: string, id: string, dto: CreateLayoutDto) {
    await this.findOne(orgId, id);
    await this.validateZones(orgId, dto.zones);

    // Replace all zones atomically
    await this.prisma.zone.deleteMany({ where: { layoutId: id } });

    return this.prisma.layout.update({
      where: { id },
      data: {
        name: dto.name,
        zones: { create: dto.zones.map(z => this.zoneCreateData(z)) },
      },
      include: this.zonesInclude,
    });
  }

  async remove(orgId: string, id: string) {
    await this.findOne(orgId, id);

    // Screen.layoutId has no onDelete: Cascade — check first so an in-use layout gets a
    // clear error instead of a raw foreign-key failure (see the identical fix on assets).
    const screenCount = await this.prisma.screen.count({ where: { layoutId: id } });
    if (screenCount > 0) {
      throw new BadRequestException(
        `This layout is assigned to ${screenCount} screen${screenCount === 1 ? '' : 's'}. Unassign it from those screens before deleting.`,
      );
    }

    await this.prisma.layout.delete({ where: { id } });
  }
}
