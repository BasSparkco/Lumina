import { Injectable } from '@nestjs/common';
import type { DesignTemplate, Prisma } from '@lumina/db';
import { PrismaService } from '../../prisma/prisma.service';
import { OrgScopedService } from '../../common/org-scoped.service';

@Injectable()
export class DesignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgScoped: OrgScopedService,
  ) {}

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
  // exposed as its own customer-facing "clone any template id" endpoint. Full "create from
  // scratch" persistence (POST /designs) is designer.md Phase 10.
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
}
