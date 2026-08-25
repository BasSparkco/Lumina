'use client';
import { useEffect, useRef } from 'react';

export type HotkeyMap = Record<string, () => void>;

// A spec is either a bare key ("Delete", "Backspace") or "mod+<key>" ("mod+d", "mod+c",
// "mod+v"), where "mod" means Ctrl on Windows/Linux or Cmd on Mac.
function matches(spec: string, e: KeyboardEvent): boolean {
  const [prefix, key] = spec.includes('+') ? spec.split('+') : [null, spec];
  if (prefix === 'mod' && !(e.ctrlKey || e.metaKey)) return false;
  if (prefix === null && (e.ctrlKey || e.metaKey)) return false;
  return e.key.toLowerCase() === key!.toLowerCase();
}

/**
 * Keyboard shortcut infrastructure (designer.md §31 Phase 1/2). Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z
 * are already bound globally by useEditorHistory (via useDesignerHistory) — do not rebind them
 * here, or two competing keydown handlers will both fire on every undo/redo.
 */
export function useHotkeys(bindings: HotkeyMap): void {
  const latest = useRef(bindings);
  useEffect(() => {
    latest.current = bindings;
  });

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      for (const [spec, handler] of Object.entries(latest.current)) {
        if (matches(spec, e)) {
          e.preventDefault();
          handler();
          return;
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
