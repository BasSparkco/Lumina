'use client';
import { useState } from 'react';
import { ArrowDownToLine, ArrowUpToLine, ChevronDown, ChevronUp, Copy, Eye, EyeOff, Lock, LockOpen, Trash2 } from 'lucide-react';
import { LayersPanel as SharedLayersPanel } from '@/components/LayersPanel';
import { ContextMenu, type ContextMenuState } from '@/components/ContextMenu';
import { useConfirmBeforeDelete } from '@/hooks/useConfirmBeforeDelete';
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
  const updateElement = useDesignerStore((s) => s.updateElement);
  const removeElements = useDesignerStore((s) => s.removeElements);
  const duplicateElements = useDesignerStore((s) => s.duplicateElements);
  const reorderElement = useDesignerStore((s) => s.reorderElement);
  const { confirmDelete } = useConfirmBeforeDelete();
  const [rowActionsMenu, setRowActionsMenu] = useState<ContextMenuState | null>(null);

  const scene = document?.scenes.find((s) => s.id === activeSceneId);
  const items = (scene?.elements ?? [])
    .slice()
    .sort((a, b) => b.zIndex - a.zIndex)
    .map((el) => ({
      id: el.id, zIndex: el.zIndex, label: el.name,
      visible: el.visible, locked: !el.movable && !el.resizable,
    }));

  // Only a single selected object gets an inline expansion under its own row — a multi-selection
  // has no one row to attach to, so its (align/duplicate/delete) properties render as a single
  // block under the whole list instead, matching PropertiesPanel's own multi-select branch.
  const singleSelectedId = selectedElementIds.length === 1 ? selectedElementIds[0]! : null;
  const [propertiesState, setPropertiesState] = useState({ selectedId: singleSelectedId, collapsed: false });

  // A new selection opens its properties; collapsing only changes the sidebar, not the canvas selection.
  if (propertiesState.selectedId !== singleSelectedId) {
    setPropertiesState({ selectedId: singleSelectedId, collapsed: false });
  }

  function handleSelect(id: string) {
    if (id === singleSelectedId) {
      setPropertiesState((state) => ({ selectedId: id, collapsed: !state.collapsed }));
    } else {
      setSelection([id]);
    }
  }

  // Same action set/semantics as CanvasViewport's own right-click menu (buildContextMenuActions)
  // — a Layers-panel row and its canvas element are the same thing, so both surfaces offer the
  // same discoverable set: designer_modernization_plan.md M4's "row rename, visibility, lock,
  // duplicate/delete and four reorder actions", here as a "..." popup rather than eight always-
  // visible icons crowding a compact row.
  function openRowActions(id: string, anchor: DOMRect) {
    const element = scene?.elements.find((el) => el.id === id);
    if (!element) return;
    const isLocked = !element.movable && !element.resizable;
    setRowActionsMenu({
      x: anchor.left,
      y: anchor.bottom + 4,
      actions: [
        { key: 'front', label: 'Bring to Front', icon: ArrowUpToLine, onClick: () => commit(() => reorderElement(id, 'front')) },
        { key: 'forward', label: 'Bring Forward', icon: ChevronUp, onClick: () => commit(() => reorderElement(id, 'forward')) },
        { key: 'backward', label: 'Send Backward', icon: ChevronDown, onClick: () => commit(() => reorderElement(id, 'backward')) },
        { key: 'back', label: 'Send to Back', icon: ArrowDownToLine, onClick: () => commit(() => reorderElement(id, 'back')) },
        { key: 'duplicate', label: 'Duplicate', icon: Copy, onClick: () => commit(() => duplicateElements([id])), separator: true },
        {
          key: 'visibility', label: element.visible ? 'Hide' : 'Show', icon: element.visible ? EyeOff : Eye,
          onClick: () => commit(() => updateElement(id, { visible: !element.visible })),
        },
        {
          key: 'lock', label: isLocked ? 'Unlock Position' : 'Lock Position', icon: isLocked ? LockOpen : Lock,
          onClick: () => commit(() => updateElement(id, { movable: isLocked, resizable: isLocked })),
        },
        {
          key: 'delete', label: 'Delete', icon: Trash2, danger: true, disabled: !element.deletable, separator: true,
          onClick: () => {
            if (!confirmDelete('Delete this element?')) return;
            commit(() => removeElements([id]));
          },
        },
      ],
    });
  }

  return (
    <div className="flex h-full flex-col">
      <SharedLayersPanel
        open
        onOpenChange={() => {}}
        items={items}
        selectedId={selectedElementIds[0] ?? null}
        onSelect={handleSelect}
        onReorder={onReorder}
        title="Objects"
        emptyLabel="No objects yet"
        closeLabel="Close"
        variant="inline"
        expandedId={propertiesState.collapsed ? null : singleSelectedId}
        renderExpanded={() => <PropertiesPanel adapter={adapter} commit={commit} isTemplateMode={isTemplateMode} />}
        onToggleVisibility={(id) => {
          const element = scene?.elements.find((el) => el.id === id);
          if (element) commit(() => updateElement(id, { visible: !element.visible }));
        }}
        onToggleLock={(id) => {
          const element = scene?.elements.find((el) => el.id === id);
          if (!element) return;
          const isLocked = !element.movable && !element.resizable;
          commit(() => updateElement(id, { movable: isLocked, resizable: isLocked }));
        }}
        onRename={(id, name) => commit(() => updateElement(id, { name }))}
        onOpenActions={openRowActions}
      />
      {selectedElementIds.length > 1 && (
        <div className="shrink-0 border-t border-[var(--deck-glass-border-soft)]">
          <PropertiesPanel adapter={adapter} commit={commit} isTemplateMode={isTemplateMode} />
        </div>
      )}
      <ContextMenu state={rowActionsMenu} onClose={() => setRowActionsMenu(null)} />
    </div>
  );
}
