import type { AutosaveStatus } from '../hooks/useAutosave';

// designer.md §26's own four states, driven by useAutosave.ts. This tracks the background
// autosave *draft* only (a recovery copy, not a real save) — labeled "Draft…" rather than the
// bare "Saved"/"Saving…" it used to say, since that wording was indistinguishable from the
// manual Save button's own outcome (see SaveResult next to it) and is exactly what left users
// unsure whether their real Save had gone anywhere.
const LABELS: Record<AutosaveStatus, string> = {
  idle: 'Draft not saved',
  saving: 'Saving draft…',
  saved: 'Draft saved',
  offline: 'Offline — draft stored locally',
  error: 'Draft save failed',
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
