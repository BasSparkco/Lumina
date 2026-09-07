import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@lumina/db';
import { buildBlankDesignDocument, DesignDocumentSchema, type DesignDocument } from '@lumina/design-schema';
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

  // P7 (docs/tenant_isolation_and_platform_admin_plan.md) — every assetId/posterAssetId a
  // template's designJson references must resolve to a platform-shared asset (organizationId:
  // null), never a tenant-owned one: a template visible to every authorized tenant must not leak
  // one specific tenant's private media through an embedded reference. thumbnailAssetId is already
  // enforced at the DB layer by the `designtemplate_thumbnail_shared` trigger (P5a); this covers
  // the designJson body, which the trigger can't see inside a JSON column.
  private async assertTemplateAssetsShared(document: DesignDocument): Promise<void> {
    const assetIds = this.designs.collectAssetIds(document);
    if (assetIds.length === 0) return;
    const shared = await this.prisma.asset.findMany({
      where: { id: { in: assetIds }, organizationId: null },
      select: { id: true },
    });
    if (shared.length !== assetIds.length) {
      const sharedIds = new Set(shared.map((a) => a.id));
      const nonShared = assetIds.filter((assetId) => !sharedIds.has(assetId));
      throw new BadRequestException(
        `Cannot publish: template references non-shared assets, which would leak a tenant's private media: ${nonShared.join(', ')}`,
      );
    }
  }

  // Snapshots the current designJson into an immutable DesignTemplateVersion row and atomically
  // points `publishedVersionId` at it (designer.md §10.1's "Create Template versions" + §10.2, P7).
  // customerList/customerGet/createDesign all resolve that pointer, never the live designJson
  // above — a Template keeps evolving after publish, but an admin edit made afterward is *not*
  // customer-visible until the next explicit publish, and a design already cloned from an earlier
  // version can never be retroactively changed by a later edit/unpublish/archive.
  async adminPublish(id: string) {
    const template = await this.adminGet(id);
    const document = this.validateDesignJson(template.designJson);
    if (document.scenes.length === 0) {
      throw new BadRequestException('Cannot publish a template with no scenes');
    }
    await this.assertTemplateAssetsShared(document);
    const nextVersion = template.versionNumber + 1;
    return this.prisma.$transaction(async (tx) => {
      const version = await tx.designTemplateVersion.create({
        data: {
          templateId: id,
          versionNumber: nextVersion,
          designJson: template.designJson as Prisma.InputJsonValue,
          schemaVersion: template.schemaVersion,
        },
      });
      return tx.designTemplate.update({
        where: { id },
        data: { status: 'PUBLISHED', publishedAt: new Date(), versionNumber: nextVersion, publishedVersionId: version.id },
      });
    });
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
      // Defense-in-depth alongside the status check: status flips to PUBLISHED and
      // publishedVersionId is set in the same adminPublish transaction, so this should always be
      // redundant — but a template must never be customer-resolvable without an immutable version
      // to point at.
      publishedVersionId: { not: null },
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
  // tenant cannot see/retrieve Template" must not be distinguishable from "doesn't exist"). Returns
  // the immutable published version's designJson/schemaVersion (P7), never the live, still-editable
  // DesignTemplate.designJson.
  async customerGet(orgId: string, id: string) {
    const template = await this.orgScoped.assertOwns(
      () =>
        this.prisma.designTemplate.findFirst({
          where: { id, ...this.customerVisibleWhere(orgId) },
          include: { publishedVersion: true },
        }),
      'Template not found',
    );
    // customerVisibleWhere already requires publishedVersionId: { not: null }; this narrows the
    // type for TypeScript and is otherwise unreachable.
    if (!template.publishedVersion) throw new NotFoundException('Template not found');
    return {
      id: template.id,
      name: template.name,
      description: template.description,
      category: template.category,
      thumbnailAssetId: template.thumbnailAssetId,
      publishedAt: template.publishedAt,
      versionNumber: template.publishedVersion.versionNumber,
      designJson: template.publishedVersion.designJson,
      schemaVersion: template.publishedVersion.schemaVersion,
    };
  }

  async createDesign(orgId: string, id: string) {
    const template = await this.customerGet(orgId, id);
    return this.designs.createFromTemplate(orgId, template);
  }
}
