import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { buildBlankDesignDocument } from '@lumina/design-schema';
import { DesignsService } from './designs.service';
import { OrgScopedService } from '../../common/org-scoped.service';
import type { PrismaService } from '../../prisma/prisma.service';

// P5a (docs/tenant_isolation_and_platform_admin_plan.md §2.4/§P5a task 2) — regression coverage
// for a cross-tenant IDOR fixed this milestone: `PUT /design-drafts/:documentId` used to upsert
// on `{ documentId }` alone, a *global* unique constraint (not compound with organizationId), so
// any authenticated org member who supplied another org's documentId could silently overwrite
// that org's autosave draft — designs.service.ts used to run a manual ownership check before the
// upsert to compensate. DesignDraft's uniqueness is now scoped to (organizationId, documentId)
// (see its schema comment), so the upsert's own where-clause can only ever resolve to the
// caller's own row for that documentId — there is no other-org row it could reach, by
// construction, and the manual check is gone because it's no longer needed.
describe('DesignsService — cross-tenant draft ownership', () => {
  const MY_ORG = 'org_mine';
  const DOCUMENT_ID = 'doc_123';
  const blankDoc = buildBlankDesignDocument('Test Design');

  function makeService(prismaOverrides: Record<string, unknown> = {}) {
    const prisma = {
      designDraft: {
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

  it('putDraft always scopes its upsert to (organizationId, documentId), never documentId alone', async () => {
    const { service, prisma } = makeService();

    await expect(service.putDraft(MY_ORG, 'user_1', DOCUMENT_ID, blankDoc)).resolves.toBeDefined();
    expect(prisma.designDraft.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId_documentId: { organizationId: MY_ORG, documentId: DOCUMENT_ID } } }),
    );
  });

  it('putDraft rejects an invalid designJson before ever touching the DB', async () => {
    const { service, prisma } = makeService();

    await expect(
      service.putDraft(MY_ORG, 'user_1', DOCUMENT_ID, { not: 'a valid design' }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.designDraft.upsert).not.toHaveBeenCalled();
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

  // M6 — `update()` now guards the write itself with a conditional `updateMany({where:{revision}}))`
  // inside an *interactive* transaction (`$transaction(async (tx) => ...)`), not a separate
  // app-level revision compare followed by an unconditional `update`. The mock `$transaction` here
  // supports both the pre-M6 array form (still used elsewhere in this service) and the callback
  // form, invoking the callback with `prisma` itself as `tx` — real Prisma's `tx` client has the
  // same shape, and reusing the same jest.fn()s means assertions against `prisma.designAsset.*`
  // still observe calls made via `tx.designAsset.*` inside the service.
  function makeService(revision = 5) {
    const prisma = {
      designAsset: {
        findFirst: jest.fn().mockResolvedValue({ id: DESIGN_ID, organizationId: MY_ORG, revision, name: 'Test', deletedAt: null }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: DESIGN_ID, revision: revision + 1 }),
      },
      designAssetVersion: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
      designDraft: { deleteMany: jest.fn() },
      asset: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((arg: unknown) =>
        typeof arg === 'function' ? (arg as (tx: unknown) => Promise<unknown>)(prisma) : Promise.all(arg as Promise<unknown>[])),
    } as unknown as PrismaService;
    const orgScoped = new OrgScopedService();
    return { service: new DesignsService(prisma, orgScoped), prisma };
  }

  it('update rejects a stale client revision without writing a version or deleting the draft', async () => {
    const { service, prisma } = makeService(5);
    (prisma.designAsset.updateMany as jest.Mock).mockResolvedValue({ count: 0 }); // stale — no row matched

    await expect(
      service.update(MY_ORG, DESIGN_ID, { revision: 4, designJson: blankDoc }),
    ).rejects.toThrow(ConflictException);
    expect(prisma.designAssetVersion.create).not.toHaveBeenCalled();
    expect(prisma.designDraft.deleteMany).not.toHaveBeenCalled();
  });

  it('update succeeds, guards the write with the client\'s revision, and creates a version when it matches', async () => {
    const { service, prisma } = makeService(5);

    await expect(
      service.update(MY_ORG, DESIGN_ID, { revision: 5, designJson: blankDoc }),
    ).resolves.toBeDefined();
    expect(prisma.designAsset.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: DESIGN_ID, organizationId: MY_ORG, revision: 5 }) }),
    );
    expect(prisma.designAssetVersion.create).toHaveBeenCalled();
  });

  // M6 — the actual concurrency guarantee: two overlapping requests that both read the same
  // pre-write revision (simulated here by both calling update() against a service instance whose
  // mocked `updateMany` reports a match only the *first* time) — the second must be rejected with a
  // real 409, not silently lose the race with no error, and only one DesignAssetVersion row must
  // be created for the two attempts (the "two simultaneous revisions" / "rapid consecutive saves"
  // required test scenario).
  it('rejects the loser of two concurrent updates sharing the same stale revision, creating exactly one version', async () => {
    const { service, prisma } = makeService(5);
    (prisma.designAsset.updateMany as jest.Mock)
      .mockResolvedValueOnce({ count: 1 }) // first request: matches, revision 5 -> 6
      .mockResolvedValueOnce({ count: 0 }); // second request: row is now revision 6, its own WHERE revision:5 matches nothing

    const first = service.update(MY_ORG, DESIGN_ID, { revision: 5, designJson: blankDoc });
    const second = service.update(MY_ORG, DESIGN_ID, { revision: 5, designJson: blankDoc });

    await expect(first).resolves.toBeDefined();
    await expect(second).rejects.toThrow(ConflictException);
    expect(prisma.designAssetVersion.create).toHaveBeenCalledTimes(1);
  });
});

// M4 — a design cloned from a Template carries per-element templatePolicy/movable/resizable/
// deletable restrictions; the client only ever *hid* controls for them. These confirm the server
// itself now rejects a forged PATCH that would bypass that — the actual security boundary, not
// just a UI nicety — using the immutable DesignTemplateVersion as the ground truth.
describe('DesignsService — server-side Template layer policy enforcement', () => {
  const MY_ORG = 'org_mine';
  const DESIGN_ID = 'design_1';
  const TEMPLATE_ID = 'tmpl_1';
  const TEMPLATE_VERSION = 3;

  function lockedTextElement(overrides: Record<string, unknown> = {}) {
    return {
      id: 'el_locked', name: 'Headline', type: 'text',
      x: 10, y: 10, width: 200, height: 60, rotation: 0, opacity: 1, zIndex: 0,
      selectable: true, movable: false, resizable: false, deletable: false, editable: true,
      templatePolicy: { contentEditable: false, styleEditable: false },
      text: 'Original headline', fontFamily: 'inter', fontSize: 24, fontWeight: 400,
      fill: '#000000', textAlign: 'left', direction: 'ltr',
      ...overrides,
    };
  }

  function docWith(...elements: Record<string, unknown>[]) {
    const doc = buildBlankDesignDocument('Test Design');
    doc.scenes[0]!.elements.push(...(elements as never[]));
    return doc;
  }

  function makeService(sourceElements: Record<string, unknown>[]) {
    const sourceDesignJson = docWith(...sourceElements);
    const prisma = {
      designAsset: {
        findFirst: jest.fn().mockResolvedValue({
          id: DESIGN_ID, organizationId: MY_ORG, revision: 1, name: 'Test', deletedAt: null,
          sourceTemplateId: TEMPLATE_ID, sourceTemplateVersion: TEMPLATE_VERSION,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: DESIGN_ID, revision: 2 }),
      },
      designTemplateVersion: {
        findUnique: jest.fn().mockResolvedValue({ designJson: sourceDesignJson }),
      },
      designAssetVersion: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
      designDraft: { deleteMany: jest.fn() },
      asset: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((arg: unknown) =>
        typeof arg === 'function' ? (arg as (tx: unknown) => Promise<unknown>)(prisma) : Promise.all(arg as Promise<unknown>[])),
    } as unknown as PrismaService;
    const orgScoped = new OrgScopedService();
    return { service: new DesignsService(prisma, orgScoped), prisma };
  }

  it('rejects moving a movable:false element', async () => {
    const { service, prisma } = makeService([lockedTextElement()]);
    const attempt = docWith(lockedTextElement({ x: 999 }));

    await expect(
      service.update(MY_ORG, DESIGN_ID, { revision: 1, designJson: attempt }),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.designAsset.updateMany).not.toHaveBeenCalled();
  });

  it('rejects changing the text content of a contentEditable:false element', async () => {
    const { service, prisma } = makeService([lockedTextElement()]);
    const attempt = docWith(lockedTextElement({ text: 'Hacked headline' }));

    await expect(
      service.update(MY_ORG, DESIGN_ID, { revision: 1, designJson: attempt }),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.designAsset.updateMany).not.toHaveBeenCalled();
  });

  it('rejects changing the fill color of a styleEditable:false element', async () => {
    const { service, prisma } = makeService([lockedTextElement()]);
    const attempt = docWith(lockedTextElement({ fill: '#ff0000' }));

    await expect(
      service.update(MY_ORG, DESIGN_ID, { revision: 1, designJson: attempt }),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.designAsset.updateMany).not.toHaveBeenCalled();
  });

  it('rejects flipping templatePolicy.contentEditable from false to true (an unlock attempt)', async () => {
    const { service, prisma } = makeService([lockedTextElement()]);
    const attempt = docWith(lockedTextElement({ templatePolicy: { contentEditable: true, styleEditable: false } }));

    await expect(
      service.update(MY_ORG, DESIGN_ID, { revision: 1, designJson: attempt }),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.designAsset.updateMany).not.toHaveBeenCalled();
  });

  it('rejects deleting a deletable:false element', async () => {
    const { service, prisma } = makeService([lockedTextElement()]);
    const attempt = buildBlankDesignDocument('Test Design'); // element simply absent

    await expect(
      service.update(MY_ORG, DESIGN_ID, { revision: 1, designJson: attempt }),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.designAsset.updateMany).not.toHaveBeenCalled();
  });

  it('rejects swapping a locked element to a different type under the same id', async () => {
    const { service, prisma } = makeService([lockedTextElement()]);
    const attempt = docWith({
      id: 'el_locked', name: 'Headline', type: 'shape',
      x: 10, y: 10, width: 200, height: 60, rotation: 0, opacity: 1, zIndex: 0,
      selectable: true, movable: false, resizable: false, deletable: false, editable: true,
      templatePolicy: { contentEditable: false, styleEditable: false },
      shape: 'rectangle',
    });

    await expect(
      service.update(MY_ORG, DESIGN_ID, { revision: 1, designJson: attempt }),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.designAsset.updateMany).not.toHaveBeenCalled();
  });

  it('allows an unchanged locked element through (no false positive on a legitimate no-op save)', async () => {
    const { service, prisma } = makeService([lockedTextElement()]);
    const unchanged = docWith(lockedTextElement());

    await expect(
      service.update(MY_ORG, DESIGN_ID, { revision: 1, designJson: unchanged }),
    ).resolves.toBeDefined();
    expect(prisma.designAsset.updateMany).toHaveBeenCalled();
  });

  it('allows freely editing a customer\'s own element alongside an untouched locked one', async () => {
    const ownElement = {
      id: 'el_own', name: 'My text', type: 'text',
      x: 300, y: 300, width: 100, height: 40, rotation: 0, opacity: 1, zIndex: 1,
      selectable: true, movable: true, resizable: true, deletable: true, editable: true,
      text: 'anything', fontFamily: 'inter', fontSize: 16, fontWeight: 400,
      fill: '#000000', textAlign: 'left', direction: 'ltr',
    };
    const { service, prisma } = makeService([lockedTextElement(), ownElement]);
    const edited = docWith(lockedTextElement(), { ...ownElement, x: 500, text: 'edited freely' });

    await expect(
      service.update(MY_ORG, DESIGN_ID, { revision: 1, designJson: edited }),
    ).resolves.toBeDefined();
    expect(prisma.designAsset.updateMany).toHaveBeenCalled();
  });
});
