import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ScreensService } from '../screens/screens.service';
import { OrgScopedService } from '../../common/org-scoped.service';
import type { CreateBuildingDto } from './dto/create-building.dto';
import type { CreateFloorDto } from './dto/create-floor.dto';

@Injectable()
export class BuildingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly screens: ScreensService,
    private readonly orgScoped: OrgScopedService,
  ) {}

  private readonly floorsInclude = {
    floors: {
      orderBy: { level: 'asc' as const },
      include: {
        floorPlanAsset: { select: { id: true, name: true, thumbnailKey: true } },
        _count: { select: { pois: true } },
      },
    },
  };

  async create(orgId: string, dto: CreateBuildingDto) {
    return this.prisma.building.create({ data: { name: dto.name, address: dto.address, organizationId: orgId } });
  }

  async list(orgId: string) {
    return this.prisma.building.findMany({
      where: { organizationId: orgId },
      orderBy: { name: 'asc' },
      include: this.floorsInclude,
    });
  }

  async findOne(orgId: string, id: string) {
    return this.orgScoped.assertOwns(
      () => this.prisma.building.findFirst({ where: { id, organizationId: orgId }, include: this.floorsInclude }),
      'Building not found',
    );
  }

  async update(orgId: string, id: string, dto: CreateBuildingDto) {
    await this.findOne(orgId, id);
    return this.prisma.building.update({ where: { id }, data: { name: dto.name, address: dto.address } });
  }

  async remove(orgId: string, id: string) {
    await this.findOne(orgId, id);
    // KioskLocation has onDelete: Cascade from Floor, so deleting would silently unbind any
    // kiosk pinned here with no warning — block it instead, same rationale as the layout/screen
    // in-use check on LayoutsService.remove.
    const kioskCount = await this.prisma.kioskLocation.count({ where: { floor: { buildingId: id } } });
    if (kioskCount > 0) {
      throw new BadRequestException(
        `This building has ${kioskCount} kiosk screen${kioskCount === 1 ? '' : 's'} pinned to it. Unbind them before deleting.`,
      );
    }
    await this.prisma.building.delete({ where: { id } });
  }

  // Fire/evacuation mode (7.4) — reuses Screen.emergencyActive (and ScreensService.setEmergency's
  // unconditional, instant push) rather than a parallel override system; this just fans that same
  // per-screen call out to every kiosk pinned somewhere in the building, so a drill or real
  // evacuation flips every kiosk in seconds regardless of the org's autoPublish setting. No
  // playlistId is passed, so a kiosk's own player (PlayerPage) is the one that decides what an
  // active-with-no-playlist emergency means for a WAYFINDING screen — it swaps in the
  // evacuation-route view instead of a fullscreen playlist.
  async setEvacuation(orgId: string, buildingId: string, active: boolean) {
    await this.findOne(orgId, buildingId);
    const kiosks = await this.prisma.kioskLocation.findMany({
      where: { floor: { buildingId } },
      select: { screenId: true },
    });
    for (const kiosk of kiosks) {
      await this.screens.setEmergency(orgId, kiosk.screenId, active);
    }
    return { ok: true, screenCount: kiosks.length };
  }

  // ScreenGroup-based building grouping for bulk operations (7.4) — deliberately reuses the
  // existing generic ScreenGroup model/CRUD/bulk-publish-volume endpoints rather than inventing a
  // building-aware grouping concept: this just creates (or reuses) a normal ScreenGroup named
  // after the building and syncs its membership to exactly this building's currently kiosk-bound
  // screens, so ops staff get to use the existing Screen Groups page's bulk publish/volume
  // controls on "this building's kiosks" without hand-curating membership. Screen.groupId is a
  // single scalar FK (one group per screen), so syncing reassigns membership outright — any kiosk
  // manually placed in a different group is moved into this one, and any screen that dropped out
  // of the building's kiosk set is removed from it. That's the intended, idempotent behavior of
  // an explicit "sync" action, not a silent side effect.
  async syncScreenGroup(orgId: string, buildingId: string) {
    const building = await this.findOne(orgId, buildingId);
    const kiosks = await this.prisma.kioskLocation.findMany({
      where: { floor: { buildingId } },
      select: { screenId: true },
    });
    const screenIds = kiosks.map(k => k.screenId);
    const groupName = `${building.name} kiosks`;

    let group = await this.prisma.screenGroup.findFirst({ where: { organizationId: orgId, name: groupName } });
    group ??= await this.prisma.screenGroup.create({ data: { name: groupName, organizationId: orgId } });

    await this.prisma.screen.updateMany({
      where: { groupId: group.id, id: { notIn: screenIds } },
      data: { groupId: null },
    });
    if (screenIds.length) {
      await this.prisma.screen.updateMany({ where: { id: { in: screenIds } }, data: { groupId: group.id } });
    }

    return this.prisma.screenGroup.findUnique({ where: { id: group.id }, include: { _count: { select: { screens: true } } } });
  }

  async createFloor(orgId: string, buildingId: string, dto: CreateFloorDto) {
    await this.findOne(orgId, buildingId);
    if (dto.floorPlanAssetId) await this.assertOwnsAsset(orgId, dto.floorPlanAssetId);
    const existing = await this.prisma.floor.findFirst({ where: { buildingId, level: dto.level } });
    if (existing) throw new BadRequestException(`This building already has a floor at level ${dto.level}`);
    return this.prisma.floor.create({
      data: { buildingId, level: dto.level, label: dto.label, floorPlanAssetId: dto.floorPlanAssetId },
    });
  }

  async updateFloor(orgId: string, floorId: string, dto: CreateFloorDto) {
    const floor = await this.assertOwnsFloor(orgId, floorId);
    if (dto.floorPlanAssetId) await this.assertOwnsAsset(orgId, dto.floorPlanAssetId);
    if (dto.level !== floor.level) {
      const existing = await this.prisma.floor.findFirst({ where: { buildingId: floor.buildingId, level: dto.level } });
      if (existing) throw new BadRequestException(`This building already has a floor at level ${dto.level}`);
    }
    return this.prisma.floor.update({
      where: { id: floorId },
      data: { level: dto.level, label: dto.label, floorPlanAssetId: dto.floorPlanAssetId ?? null },
    });
  }

  async removeFloor(orgId: string, floorId: string) {
    await this.assertOwnsFloor(orgId, floorId);
    const kioskCount = await this.prisma.kioskLocation.count({ where: { floorId } });
    if (kioskCount > 0) {
      throw new BadRequestException(
        `This floor has ${kioskCount} kiosk screen${kioskCount === 1 ? '' : 's'} pinned to it. Unbind them before deleting.`,
      );
    }
    await this.prisma.floor.delete({ where: { id: floorId } });
  }

  async assertOwnsFloor(orgId: string, floorId: string) {
    return this.orgScoped.assertOwns(
      () => this.prisma.floor.findFirst({ where: { id: floorId, building: { organizationId: orgId } } }),
      'Floor not found',
    );
  }

  private async assertOwnsAsset(orgId: string, assetId: string) {
    const asset = await this.orgScoped.assertOwns(
      () => this.prisma.asset.findFirst({ where: { id: assetId, organizationId: orgId } }),
      'Floor plan asset not found',
    );
    if (asset.status !== 'READY') throw new BadRequestException('Floor plan asset is not ready yet');
    return asset;
  }
}
