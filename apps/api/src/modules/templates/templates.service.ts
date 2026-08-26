import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@lumina/db';
import { buildBlankDesignDocument, DesignDocumentSchema } from '@lumina/design-schema';
import { PrismaService } from '../../prisma/prisma.service';
import { OrgScopedService } from '../../common/org-scoped.service';
import { DesignsService } from '../designs/designs.service';
import type { TemplateDto, TenantAccessDto } from './dto/template.dto';

@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgScoped: OrgScopedService,
    private readonly designs: DesignsService,
  ) {}

  private validateDesignJson(designJson: unknown) {
    const result = DesignDocumentSchema.safeParse(designJson);
    if (!result.success) {
      const message = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new BadRequestException(`Invalid template design: ${message}`);
    }
    return result.data;
  }

  // ── Super Admin (apps/dashboard's /admin/templates page) ──────────────────

  async adminList() {
    return this.prisma.designTemplate.findMany({
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { tenantAccess: true, designAssets: true } } },
    });
  }

  async adminGet(id: string) {
    return this.orgScoped.assertOwns(() => this.prisma.designTemplate.findUnique({ where: { id } }), 'Template not found');
  }

  async adminCreate(dto: TemplateDto) {
    // TemplateDto's `name` is optional overall (see its own doc comment — Save needs a
    // metadata-free PUT) but is genuinely required to create a row at all.
    if (!dto.name) throw new BadRequestException('name is required');
    const designJson = this.validateDesignJson(dto.designJson ?? buildBlankDesignDocument(dto.name));
    return this.prisma.designTemplate.create({
      data: {
        name: dto.name,
        description: dto.description,
        category: dto.category ?? 'GENERIC',
        visibility: dto.visibility ?? 'HIDDEN',
        designJson,
      },
    });
  }

  async adminUpdate(id: string, dto: TemplateDto) {
    await this.adminGet(id);
    const designJson = dto.designJson !== undefined ? this.validateDesignJson(dto.designJson) : undefined;
    return this.prisma.designTemplate.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        category: dto.category,
        visibility: dto.visibility,
        ...(designJson !== undefined ? { designJson } : {}),
      },
    });
  }

  // Snapshots the current designJson into an immutable DesignTemplateVersion row and flips the
  // template customer-visible (designer.md §10.1's "Create Template versions" + §10.2). Unlike
  // Theme (no draft/live distinction at all), a Template keeps evolving after publish — an admin
  // edit made afterward is customer-visible immediately, since customerList/customerGet/
  // createDesign all read the live designTemplate row directly, not the version snapshot; the
  // version table exists for future admin history/rollback tooling, not built yet.
  async adminPublish(id: string) {
    const template = await this.adminGet(id);
    const scenes = (template.designJson as { scenes?: unknown[] } | null)?.scenes;
    if (!Array.isArray(scenes) || scenes.length === 0) {
      throw new BadRequestException('Cannot publish a template with no scenes');
    }
    const nextVersion = template.versionNumber + 1;
    const [, updated] = await this.prisma.$transaction([
      this.prisma.designTemplateVersion.create({
        data: {
          templateId: id,
          versionNumber: nextVersion,
          designJson: template.designJson as Prisma.InputJsonValue,
          schemaVersion: template.schemaVersion,
        },
      }),
      this.prisma.designTemplate.update({
        where: { id },
        data: { status: 'PUBLISHED', publishedAt: new Date(), versionNumber: nextVersion },
      }),
    ]);
    return updated;
  }

  async adminUnpublish(id: string) {
    await this.adminGet(id);
    return this.prisma.designTemplate.update({ where: { id }, data: { status: 'DRAFT' } });
  }

  // designer.md §25 treats "Delete/archive Template" as one Super-Admin-only action — never a
  // hard delete, since DesignAsset.sourceTemplateId (designer.md §11) must keep resolving for
  // every design already cloned from this template.
  async adminArchive(id: string) {
    await this.adminGet(id);
    return this.prisma.designTemplate.update({ where: { id }, data: { status: 'ARCHIVED' } });
  }

  async adminGetTenantAccess(id: string) {
    await this.adminGet(id);
    return this.prisma.designTemplateTenant.findMany({
      where: { templateId: id },
      include: { tenant: { select: { id: true, name: true, slug: true } } },
    });
  }

  async adminSetTenantAccess(id: string, dto: TenantAccessDto) {
    await this.adminGet(id);
    const uniqueIds = [...new Set(dto.tenantIds)];
    await this.prisma.$transaction([
      this.prisma.designTemplateTenant.deleteMany({ where: { templateId: id } }),
      this.prisma.designTemplateTenant.createMany({ data: uniqueIds.map((tenantId) => ({ templateId: id, tenantId })) }),
    ]);
    return this.adminGetTenantAccess(id);
  }

  // ── Customer (designer2's Templates sidebar panel) ─────────────────────────

  private customerVisibleWhere(orgId: string): Prisma.DesignTemplateWhereInput {
    return {
      status: 'PUBLISHED',
      OR: [{ visibility: 'GLOBAL' }, { visibility: 'SELECTED_TENANTS', tenantAccess: { some: { tenantId: orgId } } }],
    };
  }

  async customerList(orgId: string) {
    return this.prisma.designTemplate.findMany({
      where: this.customerVisibleWhere(orgId),
      orderBy: { publishedAt: 'desc' },
      select: { id: true, name: true, description: true, category: true, thumbnailAssetId: true, versionNumber: true, publishedAt: true },
    });
  }

  // Not found and not-authorized deliberately return the same 404 (designer.md §24 — "unauthorized
  // tenant cannot see/retrieve Template" must not be distinguishable from "doesn't exist").
  async customerGet(orgId: string, id: string) {
    return this.orgScoped.assertOwns(
      () => this.prisma.designTemplate.findFirst({ where: { id, ...this.customerVisibleWhere(orgId) } }),
      'Template not found',
    );
  }

  async createDesign(orgId: string, id: string) {
    const template = await this.customerGet(orgId, id);
    return this.designs.createFromTemplate(orgId, template);
  }
}
