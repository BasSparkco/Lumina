'use client';
import { useEffect, useRef, useState } from 'react';
import type { DesignDocument } from '@lumina/design-schema';
import { designDraftsApi } from '@/lib/api';

export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'offline' | 'error';

const LOCAL_DEBOUNCE_MS = 500;
const BACKEND_DEBOUNCE_MS = 3000;

export function localDraftKey(documentId: string): string {
  return `designer2_draft_${documentId}`;
}

interface LocalDraft {
  document: DesignDocument;
  savedAt: string;
}

// Best-effort — localStorage can throw (quota exceeded, private/incognito mode), and local
// recovery is a nice-to-have layered under the backend draft, not something worth surfacing an
// error for. `savedAt` lets a caller (designer2/page.tsx's crash-recovery check) tell whether
// this snapshot is actually newer than whatever it's comparing against, rather than blindly
// preferring it.
export function readLocalDraft(documentId: string): LocalDraft | null {
  try {
    const raw = localStorage.getItem(localDraftKey(documentId));
    return raw ? (JSON.parse(raw) as LocalDraft) : null;
  } catch {
    return null;
  }
}

export function clearLocalDraft(documentId: string): void {
  try {
    localStorage.removeItem(localDraftKey(documentId));
  } catch {
    // best-effort, see readLocalDraft
  }
}

// designer.md §26 — two independent cadences, exactly as specified there, neither touching
// DesignAsset/revision/versions at all (that's the Manual Save path, owned by DesignerShell):
//   1. Local recovery snapshot — localStorage, lightly debounced, no network. First line of
//      defense for "browser crash/reload can recover recent work."
//   2. Backend draft — PUT /design-drafts/:documentId, debounced ~3s after inactivity (§26's
//      "approximately 2-5 seconds"). Cross-device/cross-session recovery.
// Skips the very first render of a newly-loaded document (identity change, tracked by
// `document.id`) — loading a design must not immediately re-save it as its own draft.
export function useAutosave(document: DesignDocument | null): AutosaveStatus {
  const [status, setStatus] = useState<AutosaveStatus>('idle');
  const lastDocId = useRef<string | null>(null);
  const localTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backendTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!document) return;
    if (lastDocId.current !== document.id) {
      lastDocId.current = document.id;
      return;
    }

    if (localTimer.current) clearTimeout(localTimer.current);
    localTimer.current = setTimeout(() => {
      try {
        const snapshot: LocalDraft = { document, savedAt: new Date().toISOString() };
        localStorage.setItem(localDraftKey(document.id), JSON.stringify(snapshot));
      } catch {
        // best-effort, see readLocalDraft
      }
    }, LOCAL_DEBOUNCE_MS);

    if (backendTimer.current) clearTimeout(backendTimer.current);
    setStatus('saving');
    backendTimer.current = setTimeout(() => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setStatus('offline');
        return;
      }
      designDraftsApi
        .put(document.id, document)
        .then(() => setStatus('saved'))
        .catch(() => setStatus('error'));
    }, BACKEND_DEBOUNCE_MS);

    return () => {
      if (localTimer.current) clearTimeout(localTimer.current);
      if (backendTimer.current) clearTimeout(backendTimer.current);
    };
  }, [document]);

  return status;
}
