import { describe, expect, it } from 'vitest';
import { buildBlankDesignDocument } from '@lumina/design-schema';
import { writeLocalDraft, readLocalDraft, type LocalDraft } from '@/features/designer2/hooks/useAutosave';
import { resolveLocalDraftRecovery } from '../page';

// designer_modernization_plan.md M6 — these exercise the actual "should a locally-recovered draft
// be applied" decision (resolveLocalDraftRecovery, extracted from page.tsx's load effect so it's
// testable without mounting the page's full routing/auth/dynamic-import wiring) plus readLocalDraft
// itself for the org-scoping half. Together they cover the "stale recovery JSON" and "tenant
// switch" scenarios end to end: a malformed/corrupted payload is never applied, and a draft never
// crosses from one org into another.
describe('resolveLocalDraftRecovery — stale recovery JSON (M6)', () => {
  const newer = new Date('2026-09-10T12:00:00Z').toISOString();
  const older = new Date('2026-09-01T00:00:00Z').toISOString();
  const design = { updatedAt: older };

  it('applies a valid, newer local draft', () => {
    const local: LocalDraft = { organizationId: 'org_a', documentId: 'doc_1', document: buildBlankDesignDocument('Local'), savedAt: newer };
    const result = resolveLocalDraftRecovery(local, design);
    expect(result?.name).toBe('Local');
  });

  it('ignores a local draft that is not actually newer than the saved design', () => {
    const local: LocalDraft = { organizationId: 'org_a', documentId: 'doc_1', document: buildBlankDesignDocument('Local'), savedAt: older };
    expect(resolveLocalDraftRecovery(local, { updatedAt: newer })).toBeNull();
  });

  it('ignores a null local draft', () => {
    expect(resolveLocalDraftRecovery(null, design)).toBeNull();
  });

  it('safely ignores a schema-invalid ("stale recovery JSON") payload instead of throwing or applying it', () => {
    const corrupted = { organizationId: 'org_a', documentId: 'doc_1', document: { not: 'a valid design document' }, savedAt: newer } as unknown as LocalDraft;
    expect(() => resolveLocalDraftRecovery(corrupted, design)).not.toThrow();
    expect(resolveLocalDraftRecovery(corrupted, design)).toBeNull();
  });

  it('safely ignores a pre-M6 shape missing required fields entirely', () => {
    const preMigration = { document: buildBlankDesignDocument('X'), savedAt: newer } as unknown as LocalDraft; // no organizationId/documentId
    // Still schema-valid as a *document* (the missing fields are on the wrapper, not the document
    // itself) — this specifically proves the function only cares about `local.document`'s own
    // shape, since identity validation already happened one layer up in readLocalDraft.
    expect(resolveLocalDraftRecovery(preMigration, design)?.name).toBe('X');
  });
});

describe('readLocalDraft + resolveLocalDraftRecovery — tenant switch (M6)', () => {
  it('a draft written under one org is never recovered when loading the same documentId under another org', () => {
    const document = { ...buildBlankDesignDocument('Org A Draft'), id: 'doc_shared' };
    writeLocalDraft('org_a', document);

    const olderDesign = { updatedAt: new Date('2020-01-01').toISOString() };
    const asOrgA = readLocalDraft('org_a', 'doc_shared');
    const asOrgB = readLocalDraft('org_b', 'doc_shared');

    expect(resolveLocalDraftRecovery(asOrgA, olderDesign)?.name).toBe('Org A Draft');
    expect(asOrgB).toBeNull();
    expect(resolveLocalDraftRecovery(asOrgB, olderDesign)).toBeNull();
  });
});
