import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@lumina/db';
import { ThemeInputSchema } from '@lumina/types';
import { PrismaService } from '../../prisma/prisma.service';
import type { ThemeDto } from './dto/theme.dto';

@Injectable()
export class ThemesService {
  constructor(private readonly prisma: PrismaService) {}

  private validate(dto: ThemeDto) {
    const result = ThemeInputSchema.safeParse({
      name: dto.name,
      category: dto.category,
      aspectRatio: dto.aspectRatio,
      palette: dto.palette,
      typography: dto.typography,
      elements: dto.elements,
    });
    if (!result.success) {
      const message = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new BadRequestException(`Invalid theme: ${message}`);
    }
    return result.data;
  }

  /** Presets (organizationId: null) are visible to every org, alongside the org's own themes. */
  async list(orgId: string) {
    return this.prisma.theme.findMany({
      where: { OR: [{ organizationId: null }, { organizationId: orgId }] },
      orderBy: [{ organizationId: 'asc' }, { createdAt: 'desc' }],
      include: { _count: { select: { screens: true } } },
    });
  }

  async findOne(orgId: string, id: string) {
    const theme = await this.prisma.theme.findFirst({
      where: { id, OR: [{ organizationId: null }, { organizationId: orgId }] },
    });
    if (!theme) throw new NotFoundException('Theme not found');
    return theme;
  }

  async create(orgId: string, dto: ThemeDto) {
    const validated = this.validate(dto);
    return this.prisma.theme.create({
      data: {
        name: validated.name,
        category: validated.category,
        aspectRatio: validated.aspectRatio,
        palette: validated.palette,
        typography: validated.typography,
        elements: validated.elements as unknown as Prisma.InputJsonValue,
        organizationId: orgId,
      },
    });
  }

  async update(orgId: string, id: string, dto: ThemeDto) {
    const theme = await this.findOne(orgId, id);
    if (theme.organizationId !== orgId) {
      throw new BadRequestException('This is a system preset — duplicate it to customize.');
    }
    const validated = this.validate(dto);
    return this.prisma.theme.update({
      where: { id },
      data: {
        name: validated.name,
        category: validated.category,
        aspectRatio: validated.aspectRatio,
        palette: validated.palette,
        typography: validated.typography,
        elements: validated.elements as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async duplicate(orgId: string, id: string) {
    const theme = await this.findOne(orgId, id);
    return this.prisma.theme.create({
      data: {
        name: `${theme.name} (copy)`,
        category: theme.category,
        aspectRatio: theme.aspectRatio,
        palette: theme.palette as Prisma.InputJsonValue,
        typography: theme.typography as Prisma.InputJsonValue,
        elements: theme.elements as Prisma.InputJsonValue,
        organizationId: orgId,
      },
    });
  }

  async remove(orgId: string, id: string) {
    const theme = await this.prisma.theme.findFirst({ where: { id, organizationId: orgId } });
    if (!theme) throw new NotFoundException('Theme not found');

    const screenCount = await this.prisma.screen.count({ where: { themeId: id } });
    if (screenCount > 0) {
      throw new BadRequestException(
        `This theme is assigned to ${screenCount} screen${screenCount === 1 ? '' : 's'}. Unassign it from those screens before deleting.`,
      );
    }

    await this.prisma.theme.delete({ where: { id } });
  }
}
