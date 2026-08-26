import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { buildBlankDesignDocument } from '@lumina/design-schema';
import { DesignsService } from './designs.service';
import { OrgScopedService } from '../../common/org-scoped.service';
import type { PrismaService } from '../../prisma/prisma.service';

// Phase 12 security hardening — regression coverage for a cross-tenant IDOR fixed this phase:
// `PUT /design-drafts/:documentId` upserted on `{ documentId }` alone. `documentId` carries a
// *global* unique constraint (not compound with organizationId — see DesignDraft's schema
// comment), so any authenticated org member who supplied another org's documentId could silently
// overwrite that org's autosave draft. designs.service.ts now checks ownership before the upsert.
describe('DesignsService — cross-tenant draft ownership', () => {
  const MY_ORG = 'org_mine';
  const OTHER_ORG = 'org_theirs';
  const DOCUMENT_ID = 'doc_123';
  const blankDoc = buildBlankDesignDocument('Test Design');

  function makeService(prismaOverrides: Record<string, unknown> = {}) {
    const prisma = {
      designDraft: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ documentId: DOCUMENT_ID }),
        findFirst: jest.fn(),
        deleteMany: jest.fn(),
      },
      designAsset: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), findMany: jest.fn() },
      designAssetVersion: { findFirst: jest.fn(), create: jest.fn() },
      asset: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
      ...prismaOverrides,
    } as unknown as PrismaService;
    const orgScoped = new OrgScopedService();
    return { service: new DesignsService(prisma, orgScoped), prisma };
  }

  it('putDraft rejects overwriting a draft owned by another org, without writing', async () => {
    const { service, prisma } = makeService({
      designDraft: {
        findUnique: jest.fn().mockResolvedValue({ organizationId: OTHER_ORG }),
        upsert: jest.fn(),
        findFirst: jest.fn(),
        deleteMany: jest.fn(),
      },
    });

    await expect(
      service.putDraft(MY_ORG, 'user_1', DOCUMENT_ID, blankDoc),
    ).rejects.toThrow(NotFoundException);

    expect(prisma.designDraft.upsert).not.toHaveBeenCalled();
  });

  it('putDraft succeeds creating a brand-new draft (no existing row for this documentId)', async () => {
    const { service, prisma } = makeService();

    await expect(service.putDraft(MY_ORG, 'user_1', DOCUMENT_ID, blankDoc)).resolves.toBeDefined();
    expect(prisma.designDraft.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { documentId: DOCUMENT_ID } }),
    );
  });

  it('putDraft succeeds updating a draft the caller already owns', async () => {
    const { service, prisma } = makeService({
      designDraft: {
        findUnique: jest.fn().mockResolvedValue({ organizationId: MY_ORG }),
        upsert: jest.fn().mockResolvedValue({ documentId: DOCUMENT_ID }),
        findFirst: jest.fn(),
        deleteMany: jest.fn(),
      },
    });

    await expect(service.putDraft(MY_ORG, 'user_1', DOCUMENT_ID, blankDoc)).resolves.toBeDefined();
    expect(prisma.designDraft.upsert).toHaveBeenCalled();
  });

  it('putDraft rejects an invalid designJson before ever touching the DB', async () => {
    const { service, prisma } = makeService();

    await expect(
      service.putDraft(MY_ORG, 'user_1', DOCUMENT_ID, { not: 'a valid design' }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.designDraft.findUnique).not.toHaveBeenCalled();
  });
});

describe('DesignsService — cross-tenant asset ownership on save', () => {
  const MY_ORG = 'org_mine';

  function docWithImage(assetId: string) {
    const doc = buildBlankDesignDocument('Test Design');
    // buildBlankDesignDocument always seeds exactly one scene.
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

  function makeService(ownedAssetIds: string[]) {
    const prisma = {
      designAsset: {
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => ({ id: 'design_1', revision: 0, ...data })),
      },
      designDraft: { deleteMany: jest.fn() },
      asset: { findMany: jest.fn().mockResolvedValue(ownedAssetIds.map((id) => ({ id }))) },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
    } as unknown as PrismaService;
    const orgScoped = new OrgScopedService();
    return { service: new DesignsService(prisma, orgScoped), prisma };
  }

  it('create rejects a design referencing an asset not owned by this tenant (or shared)', async () => {
    const { service } = makeService([]); // no assets resolve as owned/shared
    const doc = docWithImage('asset_belongs_to_another_org');

    await expect(
      service.create(MY_ORG, { name: 'Test', designJson: doc }),
    ).rejects.toThrow(BadRequestException);
  });

  it('create succeeds when every referenced asset is owned by this tenant', async () => {
    const { service, prisma } = makeService(['asset_mine']);
    const doc = docWithImage('asset_mine');

    await expect(service.create(MY_ORG, { name: 'Test', designJson: doc })).resolves.toBeDefined();
    expect(prisma.designAsset.create).toHaveBeenCalled();
  });
});

describe('DesignsService — stale revision conflict', () => {
  const MY_ORG = 'org_mine';
  const DESIGN_ID = 'design_1';
  const blankDoc = buildBlankDesignDocument('Test Design');

  function makeService() {
    const prisma = {
      designAsset: {
        findFirst: jest.fn().mockResolvedValue({ id: DESIGN_ID, organizationId: MY_ORG, revision: 5, name: 'Test', deletedAt: null }),
        update: jest.fn(),
      },
      designAssetVersion: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
      designDraft: { deleteMany: jest.fn() },
      asset: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
    } as unknown as PrismaService;
    const orgScoped = new OrgScopedService();
    return { service: new DesignsService(prisma, orgScoped), prisma };
  }

  it('update rejects a stale client revision without writing', async () => {
    const { service, prisma } = makeService();

    await expect(
      service.update(MY_ORG, DESIGN_ID, { revision: 4, designJson: blankDoc }),
    ).rejects.toThrow(ConflictException);
    expect(prisma.designAsset.update).not.toHaveBeenCalled();
  });

  it('update succeeds and creates a version when the revision matches', async () => {
    const { service, prisma } = makeService();
    (prisma.designAsset.update as jest.Mock).mockResolvedValue({ id: DESIGN_ID, revision: 6 });

    await expect(
      service.update(MY_ORG, DESIGN_ID, { revision: 5, designJson: blankDoc }),
    ).resolves.toBeDefined();
    expect(prisma.designAssetVersion.create).toHaveBeenCalled();
  });
});
