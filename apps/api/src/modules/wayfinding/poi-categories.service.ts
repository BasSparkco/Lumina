import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreatePoiCategoryDto } from './dto/create-poi-category.dto';

@Injectable()
export class PoiCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  // System presets (organizationId: null, seeded once) plus this org's own custom categories —
  // same visibility rule as Theme presets.
  async list(orgId: string) {
    return this.prisma.poiCategory.findMany({
      where: { OR: [{ organizationId: null }, { organizationId: orgId }] },
      orderBy: { label: 'asc' },
    });
  }

  async create(orgId: string, dto: CreatePoiCategoryDto) {
    return this.prisma.poiCategory.create({
      data: { label: dto.label, labelAr: dto.labelAr, icon: dto.icon, color: dto.color, organizationId: orgId },
    });
  }

  async update(orgId: string, id: string, dto: CreatePoiCategoryDto) {
    await this.assertOwns(orgId, id);
    return this.prisma.poiCategory.update({
      where: { id },
      data: { label: dto.label, labelAr: dto.labelAr, icon: dto.icon, color: dto.color },
    });
  }

  async remove(orgId: string, id: string) {
    await this.assertOwns(orgId, id);
    const poiCount = await this.prisma.poi.count({ where: { categoryId: id } });
    if (poiCount > 0) {
      throw new BadRequestException(`${poiCount} POI${poiCount === 1 ? '' : 's'} still use this category. Reassign or delete them first.`);
    }
    await this.prisma.poiCategory.delete({ where: { id } });
  }

  private async assertOwns(orgId: string, id: string) {
    const category = await this.prisma.poiCategory.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('POI category not found');
    if (category.organizationId === null) throw new ForbiddenException('System POI categories cannot be edited or deleted');
    if (category.organizationId !== orgId) throw new NotFoundException('POI category not found');
    return category;
  }
}
