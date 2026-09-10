import { BadRequestException, NotFoundException } from '@nestjs/common';
import { buildBlankDesignDocument } from '@lumina/design-schema';
import { TemplatesService } from './templates.service';
import { DesignsService } from '../designs/designs.service';
import { OrgScopedService } from '../../common/org-scoped.service';
import type { PrismaService } from '../../prisma/prisma.service';

// P7 (docs/tenant_isolation_and_platform_admin_plan.md) — regression coverage for the two defects
// the plan called out: (1) publish used to snapshot an immutable DesignTemplateVersion but never
// pointed customerGet/customerList/createDesign at it, so an admin edit made *after* publish was
// instantly customer-visible and could retroactively change a design a tenant had already cloned;
// (2) nothing stopped a template's designJson from embedding a tenant-private assetId, which a
// GLOBAL/SELECTED_TENANTS template would then leak to every authorized tenant.
function docWithImage(assetId: string) {
  const doc = buildBlankDesignDocument('Test Template');
  doc.scenes[0]!.elements.push({
    id: 'el_1',
    name: 'Image',
    type: 'image',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    opacity: 1,
    zIndex: 0,
    locked: false,
    visible: true,
    assetId,
  } as never);
  return doc;
}

describe('TemplatesService — publish-time shared-asset enforcement', () => {
  function makeService(sharedAssetIds: string[]) {
    const txDesignTemplateVersionCreate = jest.fn(({ data }: { data: Record<string, unknown> }) => ({
      id: 'version_new',
      ...data,
    }));
    const txDesignTemplateUpdate = jest.fn(({ data }: { data: Record<string, unknown> }) => ({ id: 'tmpl_1', ...data }));
    const prisma = {
      designTemplate: { findUnique: jest.fn() },
      asset: { findMany: jest.fn().mockResolvedValue(sharedAssetIds.map((id) => ({ id }))) },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) =>
        cb({
          designTemplateVersion: { create: txDesignTemplateVersionCreate },
          designTemplate: { update: txDesignTemplateUpdate },
        }),
      ),
    } as unknown as PrismaService;
    const orgScoped = new OrgScopedService();
    const designs = new DesignsService(prisma, orgScoped);
    return {
      service: new TemplatesService(prisma, orgScoped, designs),
      prisma,
      txDesignTemplateVersionCreate,
      txDesignTemplateUpdate,
    };
  }

  function mockTemplate(overrides: Record<string, unknown> = {}) {
    return {
      id: 'tmpl_1',
      name: 'Test Template',
      designJson: docWithImage('asset_shared'),
      schemaVersion: 1,
      versionNumber: 1,
      ...overrides,
    };
  }

  it('rejects publish when the design references an asset not owned by the platform (shared)', async () => {
    const { service, prisma } = makeService([]); // nothing resolves as shared
    (prisma.designTemplate.findUnique as jest.Mock).mockResolvedValue(mockTemplate({ designJson: docWithImage('asset_tenant_private') }));

    await expect(service.adminPublish('tmpl_1')).rejects.toThrow(BadRequestException);
  });

  it('publishes when every referenced asset is shared, and points publishedVersionId at the new snapshot', async () => {
    const { service, prisma, txDesignTemplateVersionCreate, txDesignTemplateUpdate } = makeService(['asset_shared']);
    (prisma.designTemplate.findUnique as jest.Mock).mockResolvedValue(mockTemplate());

    await service.adminPublish('tmpl_1');

    expect(txDesignTemplateVersionCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ templateId: 'tmpl_1', versionNumber: 2 }) }),
    );
    expect(txDesignTemplateUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PUBLISHED', versionNumber: 2, publishedVersionId: 'version_new' }),
      }),
    );
  });

  it('rejects publishing a template with no scenes', async () => {
    const { service, prisma } = makeService([]);
    (prisma.designTemplate.findUnique as jest.Mock).mockResolvedValue(mockTemplate({ designJson: { ...docWithImage('x'), scenes: [] } }));

    await expect(service.adminPublish('tmpl_1')).rejects.toThrow(BadRequestException);
  });
});

describe('TemplatesService — customer resolution reads the immutable published version', () => {
  function makeService(designTemplateOverrides: Record<string, unknown> | null) {
    const prisma = {
      designTemplate: { findFirst: jest.fn().mockResolvedValue(designTemplateOverrides) },
      designAsset: { create: jest.fn(({ data }: { data: Record<string, unknown> }) => ({ id: 'design_1', ...data })) },
    } as unknown as PrismaService;
    const orgScoped = new OrgScopedService();
    const designs = new DesignsService(prisma, orgScoped);
    return { service: new TemplatesService(prisma, orgScoped, designs), prisma, designs };
  }

  it('customerGet returns the published version snapshot, not the live (possibly since-edited) template row', async () => {
    const { service } = makeService({
      id: 'tmpl_1',
      name: 'Live Name Edited After Publish',
      description: null,
      category: 'GENERIC',
      thumbnailAssetId: null,
      publishedAt: new Date('2026-09-01'),
      designJson: docWithImage('asset_edited_in_live_draft'), // live row has since drifted
      publishedVersion: {
        versionNumber: 3,
        designJson: docWithImage('asset_at_publish_time'),
        schemaVersion: 1,
      },
    });

    const result = await service.customerGet('org_1', 'tmpl_1');

    expect((result.designJson as ReturnType<typeof docWithImage>).scenes[0]!.elements[0]).toMatchObject({
      assetId: 'asset_at_publish_time',
    });
    expect(result.versionNumber).toBe(3);
  });

  it('customerGet 404s when the template has no resolvable published version (unauthorized or not found)', async () => {
    const { service } = makeService(null);

    await expect(service.customerGet('org_1', 'tmpl_1')).rejects.toThrow(NotFoundException);
  });

  it('createDesign clones from the immutable published version fields, not the live template row', async () => {
    const { service, prisma } = makeService({
      id: 'tmpl_1',
      name: 'Template',
      description: null,
      category: 'GENERIC',
      thumbnailAssetId: null,
      publishedAt: new Date('2026-09-01'),
      designJson: docWithImage('asset_live_draft_only'),
      publishedVersion: { versionNumber: 5, designJson: docWithImage('asset_published'), schemaVersion: 1 },
    });

    await service.createDesign('org_1', 'tmpl_1');

    expect(prisma.designAsset.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: 'org_1',
          sourceTemplateId: 'tmpl_1',
          sourceTemplateVersion: 5,
        }),
      }),
    );
  });

  // designer_modernization_plan.md M6 — the embedded designJson.id used to be copied verbatim
  // from the source template's published version into every clone, so cloning the same template
  // twice produced two DesignAsset rows sharing the same document id — colliding DesignDraft's
  // (organizationId, documentId) unique key and the dashboard's localStorage recovery key between
  // two logically-independent designs. Confirms each clone now gets its own fresh id.
  it('createDesign gives each clone of the same Template a distinct embedded document id', async () => {
    const sharedPublishedDesignJson = docWithImage('asset_published');
    const { service, prisma } = makeService({
      id: 'tmpl_1',
      name: 'Template',
      description: null,
      category: 'GENERIC',
      thumbnailAssetId: null,
      publishedAt: new Date('2026-09-01'),
      designJson: docWithImage('asset_live_draft_only'),
      publishedVersion: { versionNumber: 5, designJson: sharedPublishedDesignJson, schemaVersion: 1 },
    });

    await service.createDesign('org_1', 'tmpl_1');
    await service.createDesign('org_1', 'tmpl_1');

    const create = prisma.designAsset.create as jest.Mock;
    expect(create).toHaveBeenCalledTimes(2);
    const firstDesignJson = create.mock.calls[0]![0].data.designJson as { id: string };
    const secondDesignJson = create.mock.calls[1]![0].data.designJson as { id: string };
    expect(firstDesignJson.id).not.toBe(secondDesignJson.id);
    expect(firstDesignJson.id).not.toBe(sharedPublishedDesignJson.id);
    // Every other field of the cloned document is untouched — only the top-level id changes.
    expect(firstDesignJson).toMatchObject({ name: sharedPublishedDesignJson.name, scenes: sharedPublishedDesignJson.scenes });
    // Regression-guard the existing provenance assertions alongside the new id-uniqueness check.
    expect(create.mock.calls[0]![0].data).toMatchObject({ organizationId: 'org_1', sourceTemplateId: 'tmpl_1', sourceTemplateVersion: 5 });
  });
});
