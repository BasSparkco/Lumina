'use client';
import { LayersPanel as SharedLayersPanel } from '@/components/LayersPanel';
import type { FabricCanvasAdapter } from '../canvas/FabricCanvasAdapter';
import { useDesignerStore } from '../state/designer.store';
import { PropertiesPanel } from './PropertiesPanel';

interface ObjectsPanelProps {
  // Commit-wrapped by the caller (DesignerShell owns useDesignerHistory) so drag-reorder is a
  // single undo step, same convention as every other mutation in this feature.
  onReorder: (orderedIdsFrontToBack: string[]) => void;
  adapter: FabricCanvasAdapter | null;
  commit: (mutator: () => void) => void;
  isTemplateMode?: boolean;
}

// Merges the old separate Layers and Properties tabs into one (designer2 UI-consolidation
// follow-up to designer.md's InspectorPanel work). Rather than switching tabs on selection, the
// selected row's properties expand inline directly beneath it via the shared LayersPanel's
// expandedId/renderExpanded hook — PropertiesPanel is reused as-is since it already derives the
// selected element straight from the store, so it renders correctly whether it's docked here
// (single selection, expanded under its row) or below the list (multi-selection, see below).
export function ObjectsPanel({ onReorder, adapter, commit, isTemplateMode }: ObjectsPanelProps) {
  const document = useDesignerStore((s) => s.document);
  const activeSceneId = useDesignerStore((s) => s.activeSceneId);
  const selectedElementIds = useDesignerStore((s) => s.selectedElementIds);
  const setSelection = useDesignerStore((s) => s.setSelection);

  const scene = document?.scenes.find((s) => s.id === activeSceneId);
  const items = (scene?.elements ?? [])
    .slice()
    .sort((a, b) => b.zIndex - a.zIndex)
    .map((el) => ({ id: el.id, zIndex: el.zIndex, label: el.name }));

  // Only a single selected object gets an inline expansion under its own row — a multi-selection
  // has no one row to attach to, so its (align/duplicate/delete) properties render as a single
  // block under the whole list instead, matching PropertiesPanel's own multi-select branch.
  const singleSelectedId = selectedElementIds.length === 1 ? selectedElementIds[0]! : null;

  return (
    <div className="flex h-full flex-col">
      <SharedLayersPanel
        open
        onOpenChange={() => {}}
        items={items}
        selectedId={selectedElementIds[0] ?? null}
        onSelect={(id) => setSelection([id])}
        onReorder={onReorder}
        title="Objects"
        emptyLabel="No objects yet"
        closeLabel="Close"
        variant="inline"
        expandedId={singleSelectedId}
        renderExpanded={() => <PropertiesPanel adapter={adapter} commit={commit} isTemplateMode={isTemplateMode} />}
      />
      {selectedElementIds.length > 1 && (
        <div className="shrink-0 border-t border-gray-100 dark:border-gray-800">
          <PropertiesPanel adapter={adapter} commit={commit} isTemplateMode={isTemplateMode} />
        </div>
      )}
    </div>
  );
}
