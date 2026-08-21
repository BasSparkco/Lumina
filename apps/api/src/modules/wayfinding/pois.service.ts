import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ScreenGateway } from '../ws/screen.gateway';
import { OrgScopedService } from '../../common/org-scoped.service';
import type { CreatePoiDto } from './dto/create-poi.dto';
import type { ImportPoisDto } from './dto/import-pois.dto';

@Injectable()
export class PoisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: ScreenGateway,
    private readonly orgScoped: OrgScopedService,
  ) {}

  // Live POI status pushes (7.4) — a facilities manager marking a tenant closed/relocated needs
  // every kiosk in that building to reflect it within seconds, same instant-update mechanism as
  // a playlist/layout publish (a bare WS "publish" nudge — the player already re-fetches the
  // whole state, which includes the wayfinding directory, on receipt). Unlike ScreensService's
  // pushIfAutoPublish, this is unconditional: POI status is live directory data, not a draft an
  // admin explicitly stages and publishes, so it shouldn't wait on the org's autoPublish setting.
  private async pushToKiosksInBuilding(buildingId: string) {
    const kiosks = await this.prisma.kioskLocation.findMany({
      where: { floor: { buildingId } },
      select: { screenId: true },
    });
    for (const kiosk of kiosks) this.gateway.sendToScreen(kiosk.screenId, { type: 'publish' });
  }

  async list(orgId: string, floorId: string) {
    await this.assertOwnsFloor(orgId, floorId);
    return this.prisma.poi.findMany({
      where: { floorId },
      orderBy: { name: 'asc' },
      include: { category: true, iconAsset: { select: { id: true, name: true, thumbnailKey: true } } },
    });
  }

  async create(orgId: string, floorId: string, dto: CreatePoiDto) {
    const floor = await this.assertOwnsFloor(orgId, floorId);
    await this.assertOwnsCategory(orgId, dto.categoryId);
    if (dto.iconAssetId) await this.assertOwnsAsset(orgId, dto.iconAssetId);
    const poi = await this.prisma.poi.create({
      data: {
        floorId,
        name: dto.name,
        nameAr: dto.nameAr,
        x: dto.x,
        y: dto.y,
        categoryId: dto.categoryId,
        description: dto.description,
        descriptionAr: dto.descriptionAr,
        status: dto.status ?? 'OPEN',
        externalRef: dto.externalRef,
        iconAssetId: dto.iconAssetId,
      },
      include: { category: true },
    });
    await this.pushToKiosksInBuilding(floor.buildingId);
    return poi;
  }

  async update(orgId: string, id: string, dto: CreatePoiDto) {
    const existing = await this.assertOwnsPoi(orgId, id);
    await this.assertOwnsCategory(orgId, dto.categoryId);
    if (dto.iconAssetId) await this.assertOwnsAsset(orgId, dto.iconAssetId);
    const poi = await this.prisma.poi.update({
      where: { id },
      data: {
        name: dto.name,
        nameAr: dto.nameAr,
        x: dto.x,
        y: dto.y,
        categoryId: dto.categoryId,
        description: dto.description,
        descriptionAr: dto.descriptionAr,
        status: dto.status ?? 'OPEN',
        externalRef: dto.externalRef,
        iconAssetId: dto.iconAssetId ?? null,
      },
      include: { category: true },
    });
    await this.pushToKiosksInBuilding(existing.floor.buildingId);
    return poi;
  }

  async remove(orgId: string, id: string) {
    const existing = await this.assertOwnsPoi(orgId, id);
    await this.prisma.poi.delete({ where: { id } });
    await this.pushToKiosksInBuilding(existing.floor.buildingId);
  }

  // Bulk import from a dashboard-parsed CSV — matches each row's categoryLabel against this
  // org's visible categories (case-insensitive) rather than requiring category ids in the
  // spreadsheet. Fails the whole batch on the first unresolved row (with its 1-based row number)
  // rather than partially importing, so a typo'd category doesn't silently drop rows.
  async import(orgId: string, floorId: string, dto: ImportPoisDto) {
    const floor = await this.assertOwnsFloor(orgId, floorId);
    const categories = await this.prisma.poiCategory.findMany({
      where: { OR: [{ organizationId: null }, { organizationId: orgId }] },
    });
    const byLabel = new Map(categories.map(c => [c.label.toLowerCase(), c.id]));

    const rows = dto.rows.map((row, i) => {
      const categoryId = byLabel.get(row.categoryLabel.toLowerCase());
      if (!categoryId) {
        throw new BadRequestException(`Row ${i + 1}: no POI category named "${row.categoryLabel}"`);
      }
      return {
        floorId,
        name: row.name,
        nameAr: row.nameAr,
        x: row.x,
        y: row.y,
        categoryId,
        description: row.description,
      };
    });

    const created = await this.prisma.poi.createMany({ data: rows });
    await this.pushToKiosksInBuilding(floor.buildingId);
    return { imported: created.count };
  }

  private async assertOwnsFloor(orgId: string, floorId: string) {
    return this.orgScoped.assertOwns(
      () => this.prisma.floor.findFirst({ where: { id: floorId, building: { organizationId: orgId } } }),
      'Floor not found',
    );
  }

  private async assertOwnsPoi(orgId: string, id: string) {
    return this.orgScoped.assertOwns(
      () => this.prisma.poi.findFirst({
        where: { id, floor: { building: { organizationId: orgId } } },
        include: { floor: true },
      }),
      'POI not found',
    );
  }

  private async assertOwnsCategory(orgId: string, categoryId: string) {
    return this.orgScoped.assertOwns(
      () => this.prisma.poiCategory.findFirst({
        where: { id: categoryId, OR: [{ organizationId: null }, { organizationId: orgId }] },
      }),
      'POI category not found',
    );
  }

  private async assertOwnsAsset(orgId: string, assetId: string) {
    return this.orgScoped.assertOwns(
      () => this.prisma.asset.findFirst({ where: { id: assetId, organizationId: orgId } }),
      'Icon asset not found',
    );
  }
}
