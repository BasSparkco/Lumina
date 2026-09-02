'use client';
import { LayersPanel as SharedLayersPanel } from '@/components/LayersPanel';
import { useDesignerStore } from '../state/designer.store';

interface DesignerLayersPanelProps {
  // Commit-wrapped by the caller (DesignerShell owns useDesignerHistory) so drag-reorder is a
  // single undo step, same convention as every other mutation in this feature.
  onReorder: (orderedIdsFrontToBack: string[]) => void;
}

// Thin adapter over the shared apps/dashboard/src/components/LayersPanel.tsx (reused for its
// drag/sort/UI logic) rather than reimplementing layer list UI from scratch. Kept local because
// the Designer will eventually need per-item lock/visibility icons and multi-select (designer.md
// §7) the shared component doesn't expose yet — better to keep that mapping here than grow the
// shared component's prop surface prematurely. Always rendered `variant="inline"`, docked as one
// of InspectorPanel's tabs — visibility is the tab switch itself, not an open/close flag, so
// there's no `open`/`onOpenChange` here (unlike the legacy Designer's modal usage of the shared
// component).
export function LayersPanel({ onReorder }: DesignerLayersPanelProps) {
  const document = useDesignerStore((s) => s.document);
  const activeSceneId = useDesignerStore((s) => s.activeSceneId);
  const selectedElementIds = useDesignerStore((s) => s.selectedElementIds);
  const setSelection = useDesignerStore((s) => s.setSelection);

  const scene = document?.scenes.find((s) => s.id === activeSceneId);
  const items = (scene?.elements ?? [])
    .slice()
    .sort((a, b) => b.zIndex - a.zIndex)
    .map((el) => ({ id: el.id, zIndex: el.zIndex, label: el.name }));

  return (
    <SharedLayersPanel
      open
      onOpenChange={() => {}}
      items={items}
      selectedId={selectedElementIds[0] ?? null}
      onSelect={(id) => setSelection([id])}
      onReorder={onReorder}
      title="Layers"
      emptyLabel="No layers yet"
      closeLabel="Close"
      variant="inline"
    />
  );
}
