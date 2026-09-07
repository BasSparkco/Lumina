'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, X } from 'lucide-react';
import { designsApi } from '@/lib/api';

interface VersionsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  designId: string | null;
  onRestored: () => void;
}

// designer.md §26 "Version Restore" — lists the DesignAssetVersion rows a manual Save creates
// (never autosave — those go to DesignDraft instead, see useAutosave.ts), each restorable.
// Restoring becomes a *new* current version rather than destroying history (§26), so this list
// only ever grows. Same drawer convention as VariablesPanel.tsx/the shared LayersPanel.tsx;
// useQuery/useMutation for the fetch/restore, matching TemplatesGalleryPanel.tsx's own pattern.
export function VersionsPanel({ open, onOpenChange, designId, onRestored }: VersionsPanelProps) {
  const qc = useQueryClient();
  const { data: versions = [], isLoading } = useQuery({
    queryKey: ['designVersions', designId],
    queryFn: () => designsApi.listVersions(designId!),
    enabled: open && !!designId,
  });

  const restoreMut = useMutation({
    mutationFn: (versionId: string) => designsApi.restoreVersion(designId!, versionId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['designVersions', designId] });
      onRestored();
      onOpenChange(false);
    },
  });

  function restore(versionId: string) {
    if (!window.confirm('Restore this version? The current content will be replaced (this creates a new version, nothing is lost).')) return;
    restoreMut.mutate(versionId);
  }

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/40" onClick={() => onOpenChange(false)} />
      <aside className="glass-popup fixed inset-y-0 end-0 z-40 flex w-80 flex-col">
        <div className="flex items-center justify-between border-b border-[var(--deck-glass-border-soft)] px-3 py-3">
          <span className="text-xs font-semibold text-[var(--deck-text-mid)]">Version History</span>
          <button onClick={() => onOpenChange(false)} title="Close" className="text-[var(--deck-text-low)] hover:text-[var(--deck-text-mid)]">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-1 flex-col gap-1 overflow-y-auto p-2">
          {!designId && <div className="px-2 py-6 text-center text-xs text-[var(--deck-text-low)]">Save this design first to see its history.</div>}
          {designId && isLoading && <div className="px-2 py-6 text-center text-xs text-[var(--deck-text-low)]">Loading…</div>}
          {designId && !isLoading && versions.length === 0 && (
            <div className="px-2 py-6 text-center text-xs text-[var(--deck-text-low)]">No saved versions yet</div>
          )}
          {restoreMut.isError && <p className="px-2 text-xs text-red-500 dark:text-red-400">{(restoreMut.error as Error).message}</p>}
          {versions.map((v) => (
            <div key={v.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-[var(--deck-glass-fill-strong)]">
              <div className="min-w-0">
                <div className="font-medium text-[var(--deck-text-hi)]">
                  v{v.versionNumber}
                  {v.reason === 'restore' && <span className="ml-1 text-[var(--deck-text-low)]">(restore)</span>}
                </div>
                <div className="text-[11px] text-[var(--deck-text-low)]">{new Date(v.createdAt).toLocaleString()}</div>
              </div>
              <button
                onClick={() => restore(v.id)}
                disabled={restoreMut.isPending}
                title="Restore this version"
                className="flex shrink-0 items-center gap-1 rounded-md border border-[var(--deck-glass-border)] px-2 py-1 text-[var(--deck-text-mid)] hover:bg-[var(--deck-glass-fill-strong)] disabled:opacity-40"
              >
                <RotateCcw className="h-3 w-3" /> Restore
              </button>
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}
