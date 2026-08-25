'use client';
import { useDesignerStore } from '../state/designer.store';

// Single non-interactive scene tab — real multi-scene timeline UI (scene add/reorder/duration,
// element start/end timing) is designer.md Phase 6.
export function TimelinePanel() {
  const document = useDesignerStore((s) => s.document);
  const scene = document?.scenes[0];

  return (
    <div className="flex h-16 shrink-0 items-center gap-2 border-t border-gray-200 px-3 dark:border-gray-800">
      {scene && (
        <span className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300">
          {scene.name} · {(scene.durationMs / 1000).toFixed(0)}s
        </span>
      )}
    </div>
  );
}
