'use client';
import { useEffect, useRef, useState } from 'react';
import { Square } from 'lucide-react';
import { useConfirmBeforeDelete } from '@/hooks/useConfirmBeforeDelete';
import { adminTemplatesApi, designsApi } from '@/lib/api';
import type { FabricCanvasAdapter } from '../canvas/FabricCanvasAdapter';
import { useDesignerStore } from '../state/designer.store';
import { useDesignerHistory } from '../state/history.store';
import { useHotkeys } from '../hooks/useHotkeys';
import { useAutosave, clearLocalDraft } from '../hooks/useAutosave';
import {
  createImagePlaceholderElement,
  createQrPlaceholderElement,
  createShapeElement,
  createTextElement,
  createVideoPlaceholderElement,
} from '../lib/defaultElements';
import { DesignerTopBar } from './DesignerTopBar';
import { DesignerSidebar } from './DesignerSidebar';
import { CanvasViewport } from './CanvasViewport';
import { PropertiesPanel } from './PropertiesPanel';
import { LayersPanel } from './LayersPanel';
import { SceneStrip } from './SceneStrip';
import { VariablesPanel } from './VariablesPanel';
import { VersionsPanel } from './VersionsPanel';

interface DesignerShellProps {
  // designer.md Phase 5 — set only when this editor instance is authoring a Template
  // (/designer2?templateId=...), gating PropertiesPanel's styleEditable/contentEditable toggles.
  templateId?: string;
  templateName?: string;
  // designer.md Phase 10 — the persisted customer DesignAsset this document was loaded from, if
  // any. Both undefined until the *first* successful save (create or autosave-then-manual-save) —
  // page.tsx owns the URL/id, DesignerShell just reports back via onDesignSaved so the parent can
  // update its own state (and the `?designId=` URL) rather than duplicating that state here.
  designId?: string | null;
  designRevision?: number;
  onDesignSaved?: (result: { id: string; revision: number }) => void;
}

// Top-level layout, per designer.md §22's suggested UI:
//   Back | Name | Undo Redo | Canvas | Preview | Save
//   Templates/Text/.../Uploads | CANVAS | Properties
//   Scenes / Timeline
// Layers is a toggled overlay (see LayersPanel), not a persistent row — matches the existing
// Layout/Theme editors' own convention.
export function DesignerShell({ templateId, templateName, designId, designRevision, onDesignSaved }: DesignerShellProps) {
  const document = useDesignerStore((s) => s.document);
  const loadDocument = useDesignerStore((s) => s.loadDocument);
  const activeSceneId = useDesignerStore((s) => s.activeSceneId);
  const zoom = useDesignerStore((s) => s.zoom);
  const selectedElementIds = useDesignerStore((s) => s.selectedElementIds);
  const setZoom = useDesignerStore((s) => s.setZoom);
  const setActiveScene = useDesignerStore((s) => s.setActiveScene);
  const setVariables = useDesignerStore((s) => s.setVariables);
  const addElement = useDesignerStore((s) => s.addElement);
  const removeElements = useDesignerStore((s) => s.removeElements);
  const duplicateElements = useDesignerStore((s) => s.duplicateElements);
  const reorderAll = useDesignerStore((s) => s.reorderAll);
  const copySelection = useDesignerStore((s) => s.copySelection);
  const pasteClipboard = useDesignerStore((s) => s.pasteClipboard);
  const [layersPanelOpen, setLayersPanelOpen] = useState(false);
  const [variablesPanelOpen, setVariablesPanelOpen] = useState(false);
  const [versionsPanelOpen, setVersionsPanelOpen] = useState(false);
  // designer.md §26 — Template authoring keeps its own simpler explicit-save-only flow (Phase 5);
  // autosave drafts are a plain-designer2 concern, so the hook gets `null` in Template mode and
  // its effect never fires.
  const saveStatus = useAutosave(!templateId ? document : null);
  // designer.md Phase 6 — a Designer-only lightweight playback loop (not the shared design-runtime
  // Player, see SceneStrip's comment / designer.md's Phase 6 amendment). Cycles scenes via the same
  // Fabric adapter already used for editing, respecting each scene's durationMs, looping.
  const [previewSceneIndex, setPreviewSceneIndex] = useState<number | null>(null);
  const previewReturnSceneId = useRef<string | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  // designer.md Phase 10 — Manual Save. `document` is already validated DesignDocument state, so
  // no re-validation here — the API re-validates it against DesignDocumentSchema (and, for plain
  // designs, asset ownership) server-side regardless, never trusting a client-shaped payload as-is.
  // Three branches: Template authoring (unchanged since Phase 5), updating an already-persisted
  // Design Asset (revision-checked — a 409 surfaces the conflict message as-is, no auto-merge),
  // or the very first save of a brand-new design (creates the row, then reports the new id/
  // revision up to page.tsx via onDesignSaved so it can update the `?designId=` URL).
  async function handleSave() {
    if (!document) return;
    setSaving(true);
    setSaveError(null);
    try {
      if (templateId) {
        await adminTemplatesApi.update(templateId, { designJson: document });
      } else if (designId) {
        const updated = await designsApi.update(designId, { designJson: document, revision: designRevision ?? 1 });
        clearLocalDraft(document.id);
        onDesignSaved?.({ id: updated.id, revision: updated.revision });
      } else {
        const created = await designsApi.create({ name: document.name, designJson: document });
        clearLocalDraft(document.id);
        onDesignSaved?.({ id: created.id, revision: created.revision });
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  // designer.md §26 "Restored version becomes a new current version" — VersionsPanel already
  // performed the restore server-side by the time this fires; this just pulls the now-current
  // content back into the editor and syncs the revision page.tsx is tracking.
  async function handleRestored() {
    if (!designId) return;
    const fresh = await designsApi.get(designId);
    loadDocument(fresh.designJson);
    onDesignSaved?.({ id: fresh.id, revision: fresh.revision });
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

  function stopPreview() {
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = null;
    setPreviewSceneIndex(null);
    if (previewReturnSceneId.current) setActiveScene(previewReturnSceneId.current);
    previewReturnSceneId.current = null;
  }

  function startPreview() {
    if (!document || document.scenes.length === 0) return;
    previewReturnSceneId.current = activeSceneId;
    setPreviewSceneIndex(0);
    setActiveScene(document.scenes[0]!.id);
  }

  const previewing = previewSceneIndex !== null;

  // Advances to the next scene after the current one's durationMs, looping back to the start —
  // signage designs loop, and there's no "stop after last scene" requirement in designer.md §28.
  useEffect(() => {
    if (previewSceneIndex === null || !document) return;
    const scene = document.scenes[previewSceneIndex];
    if (!scene) return;
    previewTimer.current = setTimeout(() => {
      const nextIndex = (previewSceneIndex + 1) % document.scenes.length;
      setPreviewSceneIndex(nextIndex);
      setActiveScene(document.scenes[nextIndex]!.id);
    }, scene.durationMs);
    return () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setActiveScene is a stable zustand action
  }, [previewSceneIndex, document]);

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
        onToggleVersions={() => setVersionsPanelOpen((v) => !v)}
        onSave={document ? () => void handleSave() : undefined}
        saving={saving}
        saveError={saveError}
        saveStatus={saveStatus}
        previewing={previewing}
        onTogglePreview={previewing ? stopPreview : startPreview}
      />
      <div className="flex min-h-0 flex-1">
        {!previewing && (
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
            onAddVideoPlaceholder={() => {
              if (document && activeScene) commit(() => addElement(createVideoPlaceholderElement(document.canvas, activeScene.elements)));
            }}
            onToggleVariables={() => setVariablesPanelOpen((v) => !v)}
          />
        )}
        <div className="relative min-w-0 flex-1">
          <CanvasViewport commit={commit} onAdapterReady={setAdapter} />
          {previewing && (
            // A single layer on top of the canvas: its own presence (painted after CanvasViewport,
            // covering the full area) blocks pointer events from reaching the canvas underneath —
            // playback must not let a stray click select/drag an element and mutate the document
            // mid-loop — while the Stop bar nested inside it stays normally clickable.
            <div className="absolute inset-0 flex flex-col">
              <div className="flex-1" />
              <div className="flex items-center justify-center gap-3 border-t border-gray-200 bg-white/90 py-2 text-xs text-gray-600 backdrop-blur dark:border-gray-800 dark:bg-gray-900/90 dark:text-gray-300">
                <span>
                  Previewing · Scene {(previewSceneIndex ?? 0) + 1}/{document?.scenes.length ?? 1}
                </span>
                <button
                  onClick={stopPreview}
                  className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
                >
                  <Square className="h-3 w-3" /> Stop
                </button>
              </div>
            </div>
          )}
        </div>
        {!previewing && <PropertiesPanel adapter={adapter} commit={commit} isTemplateMode={!!templateId} />}
      </div>
      {!previewing && <SceneStrip commit={commit} adapter={adapter} />}
      <LayersPanel
        open={layersPanelOpen && !previewing}
        onOpenChange={setLayersPanelOpen}
        onReorder={(orderedIds) => commit(() => reorderAll(orderedIds))}
      />
      <VariablesPanel
        open={variablesPanelOpen && !previewing}
        onOpenChange={setVariablesPanelOpen}
        variables={document?.variables ?? {}}
        onCommit={(next) => commit(() => setVariables(next))}
      />
      <VersionsPanel
        open={versionsPanelOpen && !previewing}
        onOpenChange={setVersionsPanelOpen}
        designId={designId ?? null}
        onRestored={() => void handleRestored()}
      />
    </div>
  );
}
