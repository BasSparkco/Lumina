import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBlankDesignDocument, type DesignDocument } from '@lumina/design-schema';
import { designDraftsApi } from '@/lib/api';
import {
  clearLocalDraft,
  localDraftKey,
  readLocalDraft,
  useAutosave,
  writeLocalDraft,
} from '../useAutosave';

vi.mock('@/lib/api', () => ({ designDraftsApi: { put: vi.fn(), get: vi.fn(), remove: vi.fn() } }));

const ORG_A = 'org_a';
const ORG_B = 'org_b';

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  vi.mocked(designDraftsApi.put).mockResolvedValue({ documentId: 'x', draftJson: {} } as never);
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function doc(id = 'design_1'): DesignDocument {
  return { ...buildBlankDesignDocument('Test'), id };
}

// designer_modernization_plan.md M6 — jsdom fake timers prove the *ordering/cancellation logic*
// (does a cancelled or superseded timer fire, does a stale response get ignored) — not real
// network timing. That distinction matters for these debounce/race tests specifically.
describe('useAutosave — cancelPending stops a delayed draft from resurrecting after manual Save (M6)', () => {
  it('a pending backend PUT never fires once cancelPending() is called before it would have', () => {
    // The hook's own "skip first render" guard means only the *second* effect run for a given
    // document.id actually schedules anything — a genuinely new object with the same id, exactly
    // like a real edit (which always produces a new `document` reference in the store).
    const { result, rerender } = renderHook(({ d }) => useAutosave(d, ORG_A), { initialProps: { d: doc('design_1') } });
    rerender({ d: doc('design_1') });

    act(() => { result.current.cancelPending(); });
    act(() => { vi.advanceTimersByTime(10_000); });

    expect(designDraftsApi.put).not.toHaveBeenCalled();
  });

  it('an already-in-flight PUT does not flip status to "saved" after cancelPending() runs', async () => {
    let resolvePut!: () => void;
    vi.mocked(designDraftsApi.put).mockReturnValue(new Promise((resolve) => { resolvePut = () => resolve({} as never); }));
    const { result, rerender } = renderHook(({ d }) => useAutosave(d, ORG_A), { initialProps: { d: doc('design_1') } });
    rerender({ d: doc('design_1') });

    await act(async () => { vi.advanceTimersByTime(3000); }); // fire the backend PUT
    expect(designDraftsApi.put).toHaveBeenCalledOnce();

    act(() => { result.current.cancelPending(); }); // simulates handleSave's call, mid-flight
    await act(async () => { resolvePut(); await Promise.resolve(); });

    expect(result.current.status).not.toBe('saved');
  });
});

describe('useAutosave — stale-ack rejection', () => {
  it('an older PUT resolving after a newer one does not clobber the newer status', async () => {
    let resolveFirst!: () => void;
    const firstPromise = new Promise<unknown>((resolve) => { resolveFirst = () => resolve({}); });
    vi.mocked(designDraftsApi.put).mockReturnValueOnce(firstPromise as never).mockResolvedValueOnce({} as never);

    const { rerender, result } = renderHook(({ d }) => useAutosave(d, ORG_A), { initialProps: { d: doc('design_1') } });
    rerender({ d: doc('design_1') });
    await act(async () => { vi.advanceTimersByTime(3000); }); // first PUT sent, still pending

    // A new edit re-triggers the effect, scheduling and firing a second PUT before the first
    // resolves — this second one should be the one that determines the final status.
    rerender({ d: { ...doc('design_1'), name: 'Edited' } });
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(designDraftsApi.put).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('saved');

    // The first (stale) PUT now resolves — must not flip status away from what the second set.
    await act(async () => { resolveFirst(); await Promise.resolve(); });
    expect(result.current.status).toBe('saved');
  });
});

describe('useAutosave — offline handling', () => {
  it('sets status to offline without attempting the PUT when navigator.onLine is false', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const { result, rerender } = renderHook(({ d }) => useAutosave(d, ORG_A), { initialProps: { d: doc('design_1') } });
    rerender({ d: doc('design_1') });

    await act(async () => { vi.advanceTimersByTime(3000); });

    expect(designDraftsApi.put).not.toHaveBeenCalled();
    expect(result.current.status).toBe('offline');
  });

  it('retries once, not in a loop, when connectivity returns', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const { result, rerender } = renderHook(({ d }) => useAutosave(d, ORG_A), { initialProps: { d: doc('design_1') } });
    rerender({ d: doc('design_1') });
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(result.current.status).toBe('offline');

    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await Promise.resolve();
    });

    expect(designDraftsApi.put).toHaveBeenCalledOnce();
    expect(result.current.status).toBe('saved');

    // A second 'online' event with status already 'saved' must not fire another PUT — this is a
    // single-shot nudge, not a listener that retries on every subsequent online event regardless.
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await Promise.resolve();
    });
    expect(designDraftsApi.put).toHaveBeenCalledOnce();
  });
});

describe('useAutosave / local draft — org-scoping (M6, tenant switch)', () => {
  it('writes and reads under an org-scoped key; a different org never sees it', () => {
    const document = doc('shared_doc_id');
    writeLocalDraft(ORG_A, document);

    expect(readLocalDraft(ORG_A, document.id)?.document.id).toBe(document.id);
    expect(readLocalDraft(ORG_B, document.id)).toBeNull();
  });

  it('clears only the calling org\'s draft, leaving another org\'s draft for the same documentId intact', () => {
    const document = doc('shared_doc_id');
    writeLocalDraft(ORG_A, document);
    writeLocalDraft(ORG_B, document);

    clearLocalDraft(ORG_A, document.id);

    expect(readLocalDraft(ORG_A, document.id)).toBeNull();
    expect(readLocalDraft(ORG_B, document.id)?.document.id).toBe(document.id);
  });

  it('a pre-M6 unscoped key is cleaned up on read and is never returned', () => {
    const document = doc('shared_doc_id');
    localStorage.setItem(`designer2_draft_${document.id}`, JSON.stringify({ document, savedAt: new Date().toISOString() }));

    expect(readLocalDraft(ORG_A, document.id)).toBeNull();
    expect(localStorage.getItem(`designer2_draft_${document.id}`)).toBeNull();
  });

  it('ignores a payload whose embedded identity fields do not match what was asked for', () => {
    const document = doc('doc_1');
    // Write directly under org A's key but with a payload claiming to belong to org B — a
    // corrupted/mismatched entry, the concrete "stale recovery JSON" mechanism.
    localStorage.setItem(localDraftKey(ORG_A, document.id), JSON.stringify({
      organizationId: ORG_B, documentId: document.id, document, savedAt: new Date().toISOString(),
    }));

    expect(readLocalDraft(ORG_A, document.id)).toBeNull();
  });

  it('the local-write timer never fires while orgId is unavailable', async () => {
    const { rerender } = renderHook(({ d, org }: { d: DesignDocument; org: string | null }) => useAutosave(d, org), { initialProps: { d: doc('design_1'), org: null } });
    rerender({ d: doc('design_1'), org: null });

    await act(async () => { vi.advanceTimersByTime(3000); });

    expect(readLocalDraft('anything', 'design_1')).toBeNull();
    expect(localStorage.length).toBe(0);
  });
});
