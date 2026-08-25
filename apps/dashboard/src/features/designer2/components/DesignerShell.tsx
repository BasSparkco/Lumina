'use client';
import { useState } from 'react';
import { useConfirmBeforeDelete } from '@/hooks/useConfirmBeforeDelete';
import { adminTemplatesApi } from '@/lib/api';
import type { FabricCanvasAdapter } from '../canvas/FabricCanvasAdapter';
import { useDesignerStore } from '../state/designer.store';
import { useDesignerHistory } from '../state/history.store';
import { useHotkeys } from '../hooks/useHotkeys';
import { createImagePlaceholderElement, createQrPlaceholderElement, createShapeElement, createTextElement } from '../lib/defaultElements';
import { DesignerTopBar } from './DesignerTopBar';
import { DesignerSidebar } from './DesignerSidebar';
import { CanvasViewport } from './CanvasViewport';
import { PropertiesPanel } from './PropertiesPanel';
import { LayersPanel } from './LayersPanel';
import { TimelinePanel } from './TimelinePanel';

interface DesignerShellProps {
  // designer.md Phase 5 — set only when this editor instance is authoring a Template
  // (/designer2?templateId=...), gating the Save button and PropertiesPanel's
  // styleEditable/contentEditable toggles. Absent for plain designer2 (still no persistence —
  // designer.md Phase 10).
  templateId?: string;
  templateName?: string;
}

// Top-level layout, per designer.md §22's suggested UI:
//   Back | Name | Undo Redo | Canvas | Preview | Save
//   Templates/Text/.../Uploads | CANVAS | Properties
//   Scenes / Timeline
// Layers is a toggled overlay (see LayersPanel), not a persistent row — matches the existing
// Layout/Theme editors' own convention.
export function DesignerShell({ templateId, templateName }: DesignerShellProps) {
  const document = useDesignerStore((s) => s.document);
  const activeSceneId = useDesignerStore((s) => s.activeSceneId);
  const zoom = useDesignerStore((s) => s.zoom);
  const selectedElementIds = useDesignerStore((s) => s.selectedElementIds);
  const setZoom = useDesignerStore((s) => s.setZoom);
  const addElement = useDesignerStore((s) => s.addElement);
  const removeElements = useDesignerStore((s) => s.removeElements);
  const duplicateElements = useDesignerStore((s) => s.duplicateElements);
  const reorderAll = useDesignerStore((s) => s.reorderAll);
  const copySelection = useDesignerStore((s) => s.copySelection);
  const pasteClipboard = useDesignerStore((s) => s.pasteClipboard);
  const [layersPanelOpen, setLayersPanelOpen] = useState(false);
  // Lifted from CanvasViewport (which constructs it) so PropertiesPanel can call
  // adapter.updateElement() directly for live-feedback edits (designer.md §8 amendment) without
  // CanvasViewport needing to know anything about property-panel UI. State (not a bare ref) so
  // PropertiesPanel re-renders once the adapter becomes available after mount.
  const [adapter, setAdapter] = useState<FabricCanvasAdapter | null>(null);

  const { canUndo, canRedo, undo, redo, commit } = useDesignerHistory();
  const { confirmDelete } = useConfirmBeforeDelete();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const activeScene = document?.scenes.find((s) => s.id === activeSceneId);

  // designer.md Phase 5 — the only persistence designer2 has anywhere yet, and only for
  // Template authoring; plain customer designs still have nowhere to save to (designer.md
  // Phase 10). `document` is already validated DesignDocument state, so no re-validation here —
  // the API re-validates it against DesignDocumentSchema server-side regardless (never trusts a
  // client-shaped payload as-is).
  async function handleSave() {
    if (!templateId || !document) return;
    setSaving(true);
    setSaveError(null);
    try {
      await adminTemplatesApi.update(templateId, { designJson: document });
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  function handleDelete() {
    if (selectedElementIds.length === 0) return;
    const label = selectedElementIds.length === 1 ? 'this element' : `these ${selectedElementIds.length} elements`;
    if (!confirmDelete(`Delete ${label}?`)) return;
    commit(() => removeElements(selectedElementIds));
  }

  function handleDuplicate() {
    if (selectedElementIds.length > 0) commit(() => duplicateElements(selectedElementIds));
  }

  useHotkeys({
    Delete: handleDelete,
    Backspace: handleDelete,
    'mod+d': handleDuplicate,
    'mod+c': () => copySelection(),
    'mod+v': () => commit(() => pasteClipboard()),
  });

  return (
    <div className="flex h-full w-full flex-col">
      <DesignerTopBar
        name={templateId ? `Template: ${templateName ?? document?.name ?? '…'}` : (document?.name ?? 'Untitled Design')}
        onBack={() => window.history.back()}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
        zoom={zoom}
        onZoomIn={() => setZoom(Math.min(4, zoom * 1.2))}
        onZoomOut={() => setZoom(Math.max(0.1, zoom / 1.2))}
        onToggleLayers={() => setLayersPanelOpen((v) => !v)}
        onSave={templateId ? () => void handleSave() : undefined}
        saving={saving}
        saveError={saveError}
      />
      <div className="flex min-h-0 flex-1">
        <DesignerSidebar
          onAddText={() => {
            if (document && activeScene) commit(() => addElement(createTextElement(document.canvas, activeScene.elements)));
          }}
          onAddShape={(shape) => {
            if (document && activeScene) commit(() => addElement(createShapeElement(shape, document.canvas, activeScene.elements)));
          }}
          onAddImagePlaceholder={() => {
            if (document && activeScene) commit(() => addElement(createImagePlaceholderElement(document.canvas, activeScene.elements)));
          }}
          onAddQrPlaceholder={() => {
            if (document && activeScene) commit(() => addElement(createQrPlaceholderElement(document.canvas, activeScene.elements)));
          }}
        />
        <div className="min-w-0 flex-1">
          <CanvasViewport commit={commit} onAdapterReady={setAdapter} />
        </div>
        <PropertiesPanel adapter={adapter} commit={commit} isTemplateMode={!!templateId} />
      </div>
      <TimelinePanel />
      <LayersPanel
        open={layersPanelOpen}
        onOpenChange={setLayersPanelOpen}
        onReorder={(orderedIds) => commit(() => reorderAll(orderedIds))}
      />
    </div>
  );
}
