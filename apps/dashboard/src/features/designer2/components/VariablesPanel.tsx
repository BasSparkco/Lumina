'use client';
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';

interface VariablesPanelProps {
  variables: Record<string, string>;
  // Commit-wrapped by the caller so every edit is one undo step, same convention as every other
  // panel in this feature. `undefined` clears the document's `variables` field entirely (last
  // entry removed) rather than persisting an empty object.
  onCommit: (next: Record<string, string> | undefined) => void;
}

const inputClass =
  'w-full rounded-md border border-[var(--deck-glass-border)] bg-[var(--deck-glass-fill-strong)] px-2 py-1 text-xs text-[var(--deck-text-hi)] focus:border-[var(--deck-accent)] focus:outline-none';

function commitEntries(entries: [string, string][], onCommit: VariablesPanelProps['onCommit']) {
  const nonEmpty = entries.filter(([k]) => k.trim().length > 0);
  onCommit(nonEmpty.length > 0 ? Object.fromEntries(nonEmpty) : undefined);
}

// designer.md §17.2 — the "Design instance variables" resolution source: a plain key -> value
// map on DesignDocument.variables, referenced from element dynamic bindings as `{{key}}`.
// Docked as one of InspectorPanel's tabs (kept as its own component rather than folded into the
// shared LayersPanel.tsx — key/value rows don't fit that component's generic reorderable-item-
// list shape).
export function VariablesPanel({ variables, onCommit }: VariablesPanelProps) {
  const [newKey, setNewKey] = useState('');
  const entries = Object.entries(variables);

  function renameKey(oldKey: string, newKeyName: string, value: string) {
    const trimmed = newKeyName.trim();
    if (!trimmed || trimmed === oldKey) return;
    const next = entries.filter(([k]) => k !== oldKey);
    commitEntries([...next, [trimmed, value]], onCommit);
  }

  function updateValue(key: string, value: string) {
    commitEntries(
      entries.map(([k, v]) => [k, k === key ? value : v]),
      onCommit,
    );
  }

  function removeKey(key: string) {
    commitEntries(
      entries.filter(([k]) => k !== key),
      onCommit,
    );
  }

  function addVariable() {
    const key = newKey.trim();
    if (!key || variables[key] !== undefined) return;
    commitEntries([...entries, [key, '']], onCommit);
    setNewKey('');
  }

  return (
    <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-3">
      {entries.length === 0 && <div className="px-2 py-6 text-center text-xs text-[var(--deck-text-low)]">No variables yet</div>}
      {entries.map(([key, value]) => (
        <div key={key} className="flex items-center gap-1.5">
          <input type="text" className={inputClass} defaultValue={key} onBlur={(e) => renameKey(key, e.target.value, value)} placeholder="offer.price" />
          <input type="text" className={inputClass} defaultValue={value} onBlur={(e) => updateValue(key, e.target.value)} placeholder="value" />
          <button
            onClick={() => removeKey(key)}
            title="Remove"
            className="shrink-0 rounded p-1 text-[var(--deck-text-low)] hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30 dark:hover:text-red-400"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-1.5 border-t border-[var(--deck-glass-border-soft)] pt-2">
        <input
          type="text"
          className={inputClass}
          placeholder="new.variable"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addVariable()}
        />
        <button
          onClick={addVariable}
          disabled={!newKey.trim()}
          title="Add variable"
          className="shrink-0 rounded p-1 text-[var(--deck-text-low)] hover:bg-[var(--deck-glass-fill-strong)] hover:text-[var(--deck-text-hi)] disabled:opacity-30"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="pt-1 text-[11px] text-[var(--deck-text-low)]">
        Reference these from an element&apos;s Dynamic value field as <code>{'{{key}}'}</code>.
      </p>
    </div>
  );
}
