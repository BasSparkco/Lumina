import type { AutosaveStatus } from '../hooks/useAutosave';

// designer.md §26's own four states, driven by useAutosave.ts. Previously a static "Not saved"
// placeholder (designer.md Phase 9's own comment already mis-cited which phase — autosave itself
// is Phase 10, not 9).
const LABELS: Record<AutosaveStatus, string> = {
  idle: 'Not saved',
  saving: 'Saving…',
  saved: 'Saved',
  offline: 'Offline — changes stored locally',
  error: 'Save failed',
};

export function SaveStatus({ status }: { status: AutosaveStatus }) {
  const color =
    status === 'error'
      ? 'text-red-500 dark:text-red-400'
      : status === 'offline'
        ? 'text-amber-500 dark:text-amber-400'
        : 'text-gray-400 dark:text-gray-600';
  return <span className={`text-xs ${color}`}>{LABELS[status]}</span>;
}
