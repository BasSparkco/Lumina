'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DesignDocument } from '@lumina/design-schema';
import { designDraftsApi } from '@/lib/api';

export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'offline' | 'error';

const LOCAL_DEBOUNCE_MS = 500;
const BACKEND_DEBOUNCE_MS = 3000;

// designer_modernization_plan.md M6 — scoped by org, not just documentId. `localStorage` is
// per-browser-origin, not per-tenant, and (pre-M6) a Template cloned twice shared its embedded
// document id across two logically-independent designs — an unscoped key let one tenant's local
// draft leak into a different tenant's (or a different clone's) document load. `legacyLocalDraftKey`
// is the pre-M6 format, best-effort cleaned up on read so a stale entry can't be resurrected by any
// future code path that forgets the new scoping.
export function localDraftKey(orgId: string, documentId: string): string {
  return `designer2_draft_${orgId}_${documentId}`;
}
function legacyLocalDraftKey(documentId: string): string {
  return `designer2_draft_${documentId}`;
}

export interface LocalDraft {
  organizationId: string;
  documentId: string;
  document: DesignDocument;
  savedAt: string;
}

// Best-effort — localStorage can throw (quota exceeded, private/incognito mode), and local
// recovery is a nice-to-have layered under the backend draft, not something worth surfacing an
// error for. `savedAt` lets a caller (designer2/page.tsx's crash-recovery check) tell whether
// this snapshot is actually newer than whatever it's comparing against, rather than blindly
// preferring it. The identity fields (`organizationId`/`documentId`) are stored redundantly inside
// the payload, not just implied by the key, so a caller can validate them defensively — this is
// what makes a corrupted/mismatched entry detectable rather than silently trusted (see page.tsx's
// recovery check).
export function readLocalDraft(orgId: string, documentId: string): LocalDraft | null {
  try {
    localStorage.removeItem(legacyLocalDraftKey(documentId));
  } catch {
    // best-effort
  }
  try {
    const raw = localStorage.getItem(localDraftKey(orgId, documentId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalDraft;
    if (parsed.organizationId !== orgId || parsed.documentId !== documentId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeLocalDraft(orgId: string, document: DesignDocument): void {
  try {
    const snapshot: LocalDraft = { organizationId: orgId, documentId: document.id, document, savedAt: new Date().toISOString() };
    localStorage.setItem(localDraftKey(orgId, document.id), JSON.stringify(snapshot));
  } catch {
    // best-effort, see readLocalDraft
  }
}

export function clearLocalDraft(orgId: string, documentId: string): void {
  try {
    localStorage.removeItem(localDraftKey(orgId, documentId));
  } catch {
    // best-effort, see readLocalDraft
  }
}

export interface AutosaveHandle {
  status: AutosaveStatus;
  // designer_modernization_plan.md M6 — cancels any not-yet-fired local/backend timer and voids
  // any already-in-flight backend PUT's effect on `status` (via the sequence check below), so a
  // manual Save can call this first and guarantee no stale autosave — scheduled from an edit made
  // just before Save — resurrects a `DesignDraft` row the save's own transaction just deleted.
  cancelPending: () => void;
}

// designer.md §26 — two independent cadences, exactly as specified there, neither touching
// DesignAsset/revision/versions at all (that's the Manual Save path, owned by DesignerShell):
//   1. Local recovery snapshot — localStorage, lightly debounced, no network. First line of
//      defense for "browser crash/reload can recover recent work." Skipped entirely while `orgId`
//      is unavailable (e.g. auth still resolving) — writing an org-unscoped draft would defeat the
//      whole point of the scoping above.
//   2. Backend draft — PUT /design-drafts/:documentId, debounced ~3s after inactivity (§26's
//      "approximately 2-5 seconds"). Cross-device/cross-session recovery.
// Skips the very first render of a newly-loaded document (identity change, tracked by
// `document.id`) — loading a design must not immediately re-save it as its own draft.
export function useAutosave(document: DesignDocument | null, orgId: string | null): AutosaveHandle {
  const [status, setStatus] = useState<AutosaveStatus>('idle');
  const lastDocId = useRef<string | null>(null);
  const localTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backendTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // M6 — a monotonic per-hook-instance counter. Each scheduled backend PUT captures the current
  // value as its own `seq`; only a response whose `seq` still matches `requestSeq.current` when it
  // settles is allowed to touch `status` — this rejects a stale (out-of-order-resolving, or
  // cancelled-after-being-sent) response from clobbering a newer one.
  const requestSeq = useRef(0);

  const cancelPending = useCallback(() => {
    if (localTimer.current) { clearTimeout(localTimer.current); localTimer.current = null; }
    if (backendTimer.current) { clearTimeout(backendTimer.current); backendTimer.current = null; }
    requestSeq.current += 1;
  }, []);

  useEffect(() => {
    if (!document) return;
    if (lastDocId.current !== document.id) {
      lastDocId.current = document.id;
      return;
    }

    if (localTimer.current) clearTimeout(localTimer.current);
    if (orgId) {
      localTimer.current = setTimeout(() => writeLocalDraft(orgId, document), LOCAL_DEBOUNCE_MS);
    }

    if (backendTimer.current) clearTimeout(backendTimer.current);
    setStatus('saving');
    const seq = ++requestSeq.current;
    backendTimer.current = setTimeout(() => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        if (requestSeq.current === seq) setStatus('offline');
        return;
      }
      designDraftsApi
        .put(document.id, document)
        .then(() => { if (requestSeq.current === seq) setStatus('saved'); })
        .catch(() => { if (requestSeq.current === seq) setStatus('error'); });
    }, BACKEND_DEBOUNCE_MS);

    return () => {
      if (localTimer.current) clearTimeout(localTimer.current);
      if (backendTimer.current) clearTimeout(backendTimer.current);
    };
  }, [document, orgId]);

  // M6 offline retry — a single-shot nudge when connectivity returns, not a polling loop: the
  // debounced effect above already retries naturally on the *next* edit; this only covers "the
  // user stopped editing while offline and connectivity came back with no further edits to
  // trigger a retry on its own."
  useEffect(() => {
    if (status !== 'offline') return;
    function onOnline() {
      if (!document) return;
      setStatus('saving');
      const seq = ++requestSeq.current;
      designDraftsApi.put(document.id, document)
        .then(() => { if (requestSeq.current === seq) setStatus('saved'); })
        .catch(() => { if (requestSeq.current === seq) setStatus('error'); });
    }
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [status, document]);

  return { status, cancelPending };
}
