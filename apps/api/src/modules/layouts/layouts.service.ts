import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@lumina/db';
import { PrismaService } from '../../prisma/prisma.service';
import { OrgScopedService } from '../../common/org-scoped.service';
import type { CreateLayoutDto } from './dto/create-layout.dto';

@Injectable()
export class LayoutsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgScoped: OrgScopedService,
  ) {}

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
        await this.orgScoped.assertOwns(
          () => this.prisma.playlist.findFirst({ where: { id: z.playlistId, organizationId: orgId } }),
          `Playlist not found for zone "${z.name}"`,
        );
      }
      if (z.assetId) {
        const asset = await this.orgScoped.assertOwns(
          () => this.prisma.asset.findFirst({ where: { id: z.assetId, organizationId: orgId } }),
          `Asset not found for zone "${z.name}"`,
        );
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
      include: { ...this.zonesInclude, _count: { select: { playlistItems: true } } },
    });
  }

  async findOne(orgId: string, id: string) {
    return this.orgScoped.assertOwns(
      () => this.prisma.layout.findFirst({
        where: { id, organizationId: orgId },
        include: this.zonesInclude,
      }),
      'Layout not found',
    );
  }

  async update(orgId: string, id: string, dto: CreateLayoutDto) {
    await this.findOne(orgId, id);
    await this.validateZones(orgId, dto.zones);

    // Replace all zones atomically — deleteMany and the create-via-update below used to run as
    // two independent statements with nothing tying them together. If the create step failed
    // (a constraint error, a dropped connection), the layout was left with zero zones and every
    // screen assigned to it blanked instantly until someone re-saved it.
    return this.prisma.$transaction(async tx => {
      await tx.zone.deleteMany({ where: { layoutId: id } });
      return tx.layout.update({
        where: { id },
        data: {
          name: dto.name,
          zones: { create: dto.zones.map(z => this.zoneCreateData(z)) },
        },
        include: this.zonesInclude,
      });
    });
  }

  async remove(orgId: string, id: string) {
    await this.findOne(orgId, id);

    // PlaylistItem.layoutId has no onDelete: Cascade — check first so an in-use layout gets a
    // clear error instead of a raw foreign-key failure (see the identical fix on assets).
    const itemCount = await this.prisma.playlistItem.count({ where: { layoutId: id } });
    if (itemCount > 0) {
      throw new BadRequestException(
        `This layout is used in ${itemCount} playlist item${itemCount === 1 ? '' : 's'}. Remove it from those playlists before deleting.`,
      );
    }

    await this.prisma.layout.delete({ where: { id } });
  }
}
