'use client';
import { useEffect, useRef } from 'react';
import type { LucideIcon } from 'lucide-react';

export interface ContextMenuAction {
  key: string;
  label: string;
  icon?: LucideIcon;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  // Renders a divider line above this item — for grouping (e.g. destructive actions last).
  separator?: boolean;
}

export interface ContextMenuState {
  x: number;
  y: number;
  actions: ContextMenuAction[];
}

// Shared right-click menu for the layouts/themes editor canvases — a fixed-position popup at the
// cursor, closed by an outside click, Escape, scroll, or resize. Deliberately just a flat action
// list (no inline fields): actions either mutate directly (duplicate/delete/lock/reorder) or hand
// off to UI that already exists elsewhere (e.g. "Edit" selects + scrolls to the element's existing
// settings card) rather than re-implementing every control inside the popup.
export function ContextMenu({ state, onClose }: { state: ContextMenuState | null; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!state) return;
    function onPointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [state, onClose]);

  if (!state) return null;

  const width = 208;
  const estimatedHeight = state.actions.length * 30 + 16;
  const left = Math.min(state.x, Math.max(8, window.innerWidth - width - 8));
  const top = Math.min(state.y, Math.max(8, window.innerHeight - estimatedHeight - 8));

  return (
    <div
      ref={ref}
      style={{ position: 'fixed', top, left, width, zIndex: 1000 }}
      className="overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-xl dark:border-gray-700 dark:bg-gray-900"
    >
      {state.actions.map((action) => (
        <div key={action.key}>
          {action.separator && <div className="my-1 border-t border-gray-100 dark:border-gray-800" />}
          <button
            type="button"
            disabled={action.disabled}
            onClick={() => {
              action.onClick();
              onClose();
            }}
            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors disabled:opacity-40 ${
              action.danger
                ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30'
                : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800'
            }`}
          >
            {action.icon && <action.icon className="h-3.5 w-3.5 shrink-0" />}
            {action.label}
          </button>
        </div>
      ))}
    </div>
  );
}
