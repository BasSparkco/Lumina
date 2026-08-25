'use client';
import { ArrowLeft, Undo2, Redo2, ZoomIn, ZoomOut, Layers, Eye, Save, Loader2 } from 'lucide-react';
import { SaveStatus } from './SaveStatus';

interface DesignerTopBarProps {
  name: string;
  onBack: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onToggleLayers: () => void;
  // designer.md Phase 5 — only set when authoring a Template (designer2's only persistence so
  // far); undefined keeps Save a disabled placeholder, same as before, for plain designer2.
  onSave?: () => void;
  saving?: boolean;
  saveError?: string | null;
}

const btn =
  'inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-30 disabled:hover:bg-transparent dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100';

export function DesignerTopBar({
  name,
  onBack,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  zoom,
  onZoomIn,
  onZoomOut,
  onToggleLayers,
  onSave,
  saving,
  saveError,
}: DesignerTopBarProps) {
  return (
    <div className="flex h-14 shrink-0 items-center gap-2 border-b border-gray-200 px-3 dark:border-gray-800">
      <button className={btn} onClick={onBack} aria-label="Back">
        <ArrowLeft className="h-4 w-4" />
      </button>
      <span className="mx-1 truncate text-sm font-medium text-gray-900 dark:text-gray-100">{name}</span>

      <div className="mx-2 h-5 w-px bg-gray-200 dark:bg-gray-800" />

      <button className={btn} onClick={onUndo} disabled={!canUndo} aria-label="Undo">
        <Undo2 className="h-4 w-4" />
      </button>
      <button className={btn} onClick={onRedo} disabled={!canRedo} aria-label="Redo">
        <Redo2 className="h-4 w-4" />
      </button>

      <div className="mx-2 h-5 w-px bg-gray-200 dark:bg-gray-800" />

      <button className={btn} onClick={onZoomOut} aria-label="Zoom out">
        <ZoomOut className="h-4 w-4" />
      </button>
      <span className="w-12 text-center text-xs tabular-nums text-gray-500 dark:text-gray-400">
        {Math.round(zoom * 100)}%
      </span>
      <button className={btn} onClick={onZoomIn} aria-label="Zoom in">
        <ZoomIn className="h-4 w-4" />
      </button>

      <button className={btn} onClick={onToggleLayers} aria-label="Layers">
        <Layers className="h-4 w-4" />
      </button>

      <div className="ml-auto flex items-center gap-3">
        {saveError && <span className="text-xs text-red-500 dark:text-red-400">{saveError}</span>}
        <SaveStatus />
        {/* Preview has nothing to act on yet — no preview runtime exists (designer.md Phase 11).
            Disabled placeholder reserves its toolbar position. Save is real only in Template-
            authoring mode (onSave set) — plain designer2 still has nowhere to save to
            (designer.md Phase 10), so it stays disabled there too. */}
        <button className={btn} disabled aria-label="Preview">
          <Eye className="h-4 w-4" />
        </button>
        <button className={btn} disabled={!onSave || saving} onClick={onSave} aria-label="Save">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
