'use client';
import { useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';

interface VariablesPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  variables: Record<string, string>;
  // Commit-wrapped by the caller so every edit is one undo step, same convention as every other
  // panel in this feature. `undefined` clears the document's `variables` field entirely (last
  // entry removed) rather than persisting an empty object.
  onCommit: (next: Record<string, string> | undefined) => void;
}

const inputClass =
  'w-full rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-900 focus:border-indigo-400 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

function commitEntries(entries: [string, string][], onCommit: VariablesPanelProps['onCommit']) {
  const nonEmpty = entries.filter(([k]) => k.trim().length > 0);
  onCommit(nonEmpty.length > 0 ? Object.fromEntries(nonEmpty) : undefined);
}

// designer.md §17.2 — the "Design instance variables" resolution source: a plain key -> value
// map on DesignDocument.variables, referenced from element dynamic bindings as `{{key}}`.
// Sidebar-toggled drawer, same open/backdrop/aside convention as the shared LayersPanel.tsx
// (kept separate rather than reused — key/value rows don't fit that component's generic
// reorderable-item-list shape).
export function VariablesPanel({ open, onOpenChange, variables, onCommit }: VariablesPanelProps) {
  const [newKey, setNewKey] = useState('');
  const entries = Object.entries(variables);

  if (!open) return null;

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
    <>
      <div className="fixed inset-0 z-30 bg-black/40" onClick={() => onOpenChange(false)} />
      <aside className="fixed inset-y-0 end-0 z-40 flex w-80 flex-col bg-white shadow-lg dark:bg-gray-900">
        <div className="flex items-center justify-between border-b border-gray-100 px-3 py-3 dark:border-gray-800">
          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">Variables</span>
          <button onClick={() => onOpenChange(false)} title="Close" className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-3">
          {entries.length === 0 && <div className="px-2 py-6 text-center text-xs text-gray-400 dark:text-gray-500">No variables yet</div>}
          {entries.map(([key, value]) => (
            <div key={key} className="flex items-center gap-1.5">
              <input type="text" className={inputClass} defaultValue={key} onBlur={(e) => renameKey(key, e.target.value, value)} placeholder="offer.price" />
              <input type="text" className={inputClass} defaultValue={value} onBlur={(e) => updateValue(key, e.target.value)} placeholder="value" />
              <button
                onClick={() => removeKey(key)}
                title="Remove"
                className="shrink-0 rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:text-gray-500 dark:hover:bg-red-950/30 dark:hover:text-red-400"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <div className="flex items-center gap-1.5 border-t border-gray-100 pt-2 dark:border-gray-800">
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
              className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="pt-1 text-[11px] text-gray-400 dark:text-gray-600">
            Reference these from an element&apos;s Dynamic value field as <code>{'{{key}}'}</code>.
          </p>
        </div>
      </aside>
    </>
  );
}
