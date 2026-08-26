import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { DesignTemplate, Prisma } from '@lumina/db';
import { buildBlankDesignDocument, DesignDocumentSchema, type DesignDocument } from '@lumina/design-schema';
import { PrismaService } from '../../prisma/prisma.service';
import { OrgScopedService } from '../../common/org-scoped.service';
import type { DesignDto } from './dto/design.dto';

@Injectable()
export class DesignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgScoped: OrgScopedService,
  ) {}

  private validateDesignJson(designJson: unknown): DesignDocument {
    const result = DesignDocumentSchema.safeParse(designJson);
    if (!result.success) {
      const message = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new BadRequestException(`Invalid design: ${message}`);
    }
    return result.data;
  }

  // designer.md §20/§24 — "every referenced assetId must be authorized against current tenant
  // ownership, or platform/template-authorized shared media." Deferred here from Phase 4 (image
  // picker only ever lists tenant-scoped assets client-side, so nothing could smuggle a foreign
  // id in *through the UI* — but this is the actual persistence boundary, the one place a crafted
  // payload could still get through). Walks every assetId/posterAssetId a DesignDocument can
  // reference (Image/Video elements, Video posters, image/video scene backgrounds) and rejects if
  // any doesn't resolve to a tenant-owned or shared-library (organizationId: null) asset — same
  // shared-library convention assets.service.ts already uses.
  private collectAssetIds(document: DesignDocument): string[] {
    const ids = new Set<string>();
    for (const scene of document.scenes) {
      if (scene.background.type !== 'color') ids.add(scene.background.assetId);
      for (const element of scene.elements) {
        if (element.type === 'image' && element.assetId) ids.add(element.assetId);
        if (element.type === 'video') {
          if (element.assetId) ids.add(element.assetId);
          if (element.posterAssetId) ids.add(element.posterAssetId);
        }
      }
    }
    return [...ids];
  }

  private async assertAssetsOwned(orgId: string, document: DesignDocument): Promise<void> {
    const assetIds = this.collectAssetIds(document);
    if (assetIds.length === 0) return;
    const owned = await this.prisma.asset.findMany({
      where: { id: { in: assetIds }, OR: [{ organizationId: orgId }, { organizationId: null }] },
      select: { id: true },
    });
    if (owned.length !== assetIds.length) {
      const ownedIds = new Set(owned.map((a) => a.id));
      const missing = assetIds.filter((id) => !ownedIds.has(id));
      throw new BadRequestException(`Design references assets not owned by this tenant: ${missing.join(', ')}`);
    }
  }

  async list(orgId: string) {
    return this.prisma.designAsset.findMany({
      where: { organizationId: orgId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(orgId: string, id: string) {
    return this.orgScoped.assertOwns(
      () => this.prisma.designAsset.findFirst({ where: { id, organizationId: orgId, deletedAt: null } }),
      'Design not found',
    );
  }

  // designer.md §11's Critical Backend Rule — called by TemplatesService.createDesign only, after
  // it has already re-validated that `template` is published and authorized for `orgId`. Not
  // exposed as its own customer-facing "clone any template id" endpoint. Template designJson is
  // already-trusted Super-Admin content, not re-validated for asset ownership here — a Template's
  // own media may be platform-shared rather than tenant-owned by design.
  async createFromTemplate(orgId: string, template: DesignTemplate) {
    return this.prisma.designAsset.create({
      data: {
        organizationId: orgId,
        name: template.name,
        designJson: template.designJson as Prisma.InputJsonValue,
        schemaVersion: template.schemaVersion,
        sourceTemplateId: template.id,
        sourceTemplateVersion: template.versionNumber,
      },
    });
  }

  // designer.md Phase 10 — POST /designs. `name` required to create a row at all (same
  // TemplateDto/adminCreate convention); an omitted designJson gets a fresh blank document.
  async create(orgId: string, dto: DesignDto) {
    if (!dto.name) throw new BadRequestException('name is required');
    const designJson = this.validateDesignJson(dto.designJson ?? buildBlankDesignDocument(dto.name));
    await this.assertAssetsOwned(orgId, designJson);
    const [created] = await this.prisma.$transaction([
      this.prisma.designAsset.create({
        data: { organizationId: orgId, name: dto.name, designJson: designJson },
      }),
      // A draft may already exist for this documentId if autosave ran before the first manual
      // Save — now redundant, the DesignAsset row is the canonical copy.
      this.prisma.designDraft.deleteMany({ where: { documentId: designJson.id, organizationId: orgId } }),
    ]);
    return created;
  }

  // designer.md Phase 10 — PATCH /designs/:id, the Manual Save endpoint. `revision` is required:
  // a mismatch against the current row means someone else saved in between (another tab, another
  // device) — rejected with 409 rather than silently overwritten (Acceptance: "stale client
  // cannot silently overwrite newer server revision"). Every successful save snapshots a new
  // DesignAssetVersion — "do not create a version row for every mouse movement" is satisfied by
  // this being the *manual* save path only; autosave writes to DesignDraft instead and never
  // reaches here.
  async update(orgId: string, id: string, dto: DesignDto) {
    const existing = await this.findOne(orgId, id);
    if (dto.revision === undefined) throw new BadRequestException('revision is required');
    if (dto.designJson === undefined) throw new BadRequestException('designJson is required');
    if (dto.revision !== existing.revision) {
      throw new ConflictException('This design was saved elsewhere — reload to see the latest version.');
    }
    const designJson = this.validateDesignJson(dto.designJson);
    await this.assertAssetsOwned(orgId, designJson);

    const lastVersion = await this.prisma.designAssetVersion.findFirst({
      where: { designAssetId: id },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true },
    });
    const nextVersionNumber = (lastVersion?.versionNumber ?? 0) + 1;

    const [updated] = await this.prisma.$transaction([
      this.prisma.designAsset.update({
        where: { id },
        data: {
          name: dto.name ?? existing.name,
          designJson: designJson,
          schemaVersion: designJson.schemaVersion,
          revision: { increment: 1 },
        },
      }),
      this.prisma.designAssetVersion.create({
        data: {
          designAssetId: id,
          versionNumber: nextVersionNumber,
          designJson: designJson,
          schemaVersion: designJson.schemaVersion,
        },
      }),
      this.prisma.designDraft.deleteMany({ where: { documentId: designJson.id, organizationId: orgId } }),
    ]);
    return updated;
  }

  async listVersions(orgId: string, id: string) {
    await this.findOne(orgId, id);
    return this.prisma.designAssetVersion.findMany({
      where: { designAssetId: id },
      orderBy: { versionNumber: 'desc' },
      select: { id: true, versionNumber: true, createdAt: true, reason: true },
    });
  }

  // designer.md §26 "Restored version becomes a new current version rather than destroying
  // history" — loads the target version's json as current, but records that as ANOTHER new
  // version row (reason: 'restore') rather than rewriting/deleting anything. No revision check:
  // restoring is a deliberate, explicit user action against whatever the design's live content
  // currently is, not a background-sync race the way autosave-vs-manual-save PATCH is.
  async restoreVersion(orgId: string, id: string, versionId: string) {
    await this.findOne(orgId, id);
    const version = await this.orgScoped.assertOwns(
      () => this.prisma.designAssetVersion.findFirst({ where: { id: versionId, designAssetId: id } }),
      'Version not found',
    );
    const lastVersion = await this.prisma.designAssetVersion.findFirst({
      where: { designAssetId: id },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true },
    });
    const nextVersionNumber = (lastVersion?.versionNumber ?? 0) + 1;

    const [updated] = await this.prisma.$transaction([
      this.prisma.designAsset.update({
        where: { id },
        data: { designJson: version.designJson as Prisma.InputJsonValue, schemaVersion: version.schemaVersion, revision: { increment: 1 } },
      }),
      this.prisma.designAssetVersion.create({
        data: {
          designAssetId: id,
          versionNumber: nextVersionNumber,
          designJson: version.designJson as Prisma.InputJsonValue,
          schemaVersion: version.schemaVersion,
          reason: 'restore',
        },
      }),
    ]);
    return updated;
  }

  // ── Autosave drafts (designer.md §19.6/§26) — never touch DesignAsset/revision/versions ──────

  async getDraft(orgId: string, documentId: string) {
    return this.prisma.designDraft.findFirst({ where: { documentId, organizationId: orgId } });
  }

  // Phase 12 security hardening: `documentId` is a client-generated id with a *global* unique
  // constraint (not compound with organizationId — see schema comment), so a bare
  // `upsert({ where: { documentId } })` would happily overwrite another org's draft row if the
  // caller ever supplied (or guessed/leaked) a documentId that already belongs to someone else.
  // The explicit ownership check below is what actually enforces the tenant boundary here.
  async putDraft(orgId: string, userId: string, documentId: string, draftJson: unknown) {
    const validated = this.validateDesignJson(draftJson);
    const existing = await this.prisma.designDraft.findUnique({
      where: { documentId },
      select: { organizationId: true },
    });
    if (existing && existing.organizationId !== orgId) {
      throw new NotFoundException('Draft not found');
    }
    return this.prisma.designDraft.upsert({
      where: { documentId },
      create: { documentId, organizationId: orgId, userId, draftJson: validated },
      update: { draftJson: validated, userId },
    });
  }

  async removeDraft(orgId: string, documentId: string) {
    await this.prisma.designDraft.deleteMany({ where: { documentId, organizationId: orgId } });
  }
}
