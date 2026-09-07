'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Undo2, Redo2, ZoomIn, ZoomOut, Maximize2, Hand, Layers, History, Eye, Square, Save, Loader2, Check, Menu } from 'lucide-react';
import { useAppSidebar } from '@/context/AppSidebarContext';
import { SaveStatus } from './SaveStatus';
import type { AutosaveStatus } from '../hooks/useAutosave';

export interface SaveResult {
  kind: 'template' | 'design';
  name: string;
  href: string;
}

interface DesignerTopBarProps {
  name: string;
  // Click-to-rename, matching the Assets page's pattern — omitted (e.g. in Template-authoring
  // mode, where `name` is a "Template: X" composite, not a plain editable value) disables it and
  // the name just renders as static text.
  onRename?: (name: string) => void;
  onBack: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  // Re-centers a pan offset and re-fits zoom to the viewport (designer2 pan/zoom feature) — same
  // action as double-clicking empty canvas.
  onResetView: () => void;
  // Hand tool toggle — a persistent alternative to holding Space while dragging to pan (some
  // users find holding a key down while dragging awkward). Click to turn on, click again to
  // turn off; while on, every left-drag on the canvas pans instead of selecting/moving objects,
  // exactly as if Space were held the whole time.
  handToolActive: boolean;
  onToggleHandTool: () => void;
  onShowObjects: () => void;
  isObjectsActive?: boolean;
  onToggleVersions: () => void;
  // designer.md Phase 6 — a Designer-only scene-sequencing playback loop, not the full Player-
  // parity preview (dynamic variables/animation/video, designer.md Phase 11's design-runtime).
  previewing: boolean;
  onTogglePreview: () => void;
  // designer.md Phase 10 — Manual Save is real for both plain designer2 and Template-authoring
  // mode now; `onSave` stays optional only because DesignerShell hasn't finished loading a
  // document (or its id) yet, not because of which mode this is.
  onSave?: () => void;
  saving?: boolean;
  saveError?: string | null;
  saveStatus: AutosaveStatus;
  // Real outcome of the last manual Save — distinct from `saveStatus` above, which only ever
  // reports the background autosave draft. Cleared a few seconds after a successful save.
  saveResult?: SaveResult | null;
  // A brand-new, never-saved document opened by a Super Admin can be saved as either a Template
  // (super-admin-only, shows up on /admin/templates) or a personal Design (shows up on Assets ->
  // My Designs, same as every other user gets). Once the first save happens the mode is locked in
  // (mirrors how ?templateId=/?designId= already lock in existing documents), so this choice only
  // ever renders pre-first-save.
  saveTargetChoice?: { value: 'template' | 'design'; onChange: (v: 'template' | 'design') => void } | null;
}

const btn =
  'inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--deck-text-mid)] hover:bg-[var(--deck-glass-fill-strong)] hover:text-[var(--deck-text-hi)] disabled:opacity-30 disabled:hover:bg-transparent';
// Selected-state variant for toggleable tools (currently just the Hand tool) — the plain `btn`
// class has no "pressed" look of its own (aria-pressed alone isn't styled), so a real color
// change on click needs its own class swapped in based on the active flag.
const btnActive =
  'inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--deck-accent)] bg-[var(--deck-accent-soft)] shadow-[0_0_0_1px_var(--deck-accent-soft)]';
const divider = 'mx-2 h-5 w-px bg-[var(--deck-glass-border)]';

export function DesignerTopBar({
  name,
  onRename,
  onBack,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  zoom,
  onZoomIn,
  onZoomOut,
  onResetView,
  handToolActive,
  onToggleHandTool,
  onShowObjects,
  isObjectsActive,
  onToggleVersions,
  previewing,
  onTogglePreview,
  onSave,
  saving,
  saveError,
  saveStatus,
  saveResult,
  saveTargetChoice,
}: DesignerTopBarProps) {
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  // Opens the app-level nav sidebar (rendered as an off-canvas drawer while on designer2 — see
  // AppShell's own comment) from inside this toolbar instead of AppShell's floating top-end
  // button, which designer2 suppresses in favor of this one.
  const appSidebar = useAppSidebar();

  function startRename() {
    if (!onRename) return;
    setRenameValue(name);
    setRenaming(true);
  }

  function commitRename() {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== name) onRename?.(trimmed);
    setRenaming(false);
  }

  return (
    <div className="glass-panel mx-4 mt-[14px] mb-[14px] flex h-14 shrink-0 items-center gap-2 rounded-2xl px-3">
      {appSidebar && !appSidebar.open && (
        <>
          <button className={btn} onClick={() => appSidebar.setOpen(true)} aria-label="Open menu">
            <Menu className="h-4 w-4" />
          </button>
          <div className={divider} />
        </>
      )}
      <button className={btn} onClick={onBack} aria-label="Back">
        <ArrowLeft className="h-4 w-4" />
      </button>
      {renaming ? (
        <input
          autoFocus
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename();
            if (e.key === 'Escape') setRenaming(false);
          }}
          className="mx-1 w-48 truncate rounded border border-[var(--deck-accent)] bg-[var(--deck-glass-fill-strong)] px-1 text-sm font-medium text-[var(--deck-text-hi)] focus:outline-none focus:ring-1 focus:ring-[var(--deck-accent)]"
        />
      ) : (
        <span
          onClick={startRename}
          title={onRename ? 'Click to rename' : undefined}
          className={`mx-1 truncate text-sm font-medium text-[var(--deck-text-hi)] ${onRename ? 'cursor-text rounded px-1 hover:bg-[var(--deck-glass-fill-strong)]' : ''}`}
        >
          {name}
        </span>
      )}

      <div className={divider} />

      <button className={btn} onClick={onUndo} disabled={!canUndo} aria-label="Undo">
        <Undo2 className="h-4 w-4" />
      </button>
      <button className={btn} onClick={onRedo} disabled={!canRedo} aria-label="Redo">
        <Redo2 className="h-4 w-4" />
      </button>

      <div className={divider} />

      <button
        className={handToolActive ? btnActive : btn}
        onClick={onToggleHandTool}
        aria-pressed={handToolActive}
        aria-label="Hand tool"
        title="Hand tool — click to pan by dragging, or just hold Space"
      >
        <Hand className="h-4 w-4" />
      </button>

      <div className={divider} />

      <button className={btn} onClick={onZoomOut} aria-label="Zoom out">
        <ZoomOut className="h-4 w-4" />
      </button>
      <span className="w-12 text-center text-xs tabular-nums text-[var(--deck-text-low)]">
        {Math.round(zoom * 100)}%
      </span>
      <button className={btn} onClick={onZoomIn} aria-label="Zoom in">
        <ZoomIn className="h-4 w-4" />
      </button>
      <button className={btn} onClick={onResetView} aria-label="Fit to Screen / Reset View" title="Fit to Screen (or double-click empty canvas)">
        <Maximize2 className="h-4 w-4" />
      </button>

      <button className={btn} onClick={onShowObjects} aria-pressed={isObjectsActive} aria-label="Objects">
        <Layers className="h-4 w-4" />
      </button>

      <button className={btn} onClick={onToggleVersions} aria-label="Version history">
        <History className="h-4 w-4" />
      </button>

      <div className="ml-auto flex items-center gap-3">
        {saveTargetChoice && (
          <div className="flex items-center rounded-md border border-[var(--deck-glass-border)] p-0.5 text-xs">
            {(['design', 'template'] as const).map((v) => (
              <button
                key={v}
                onClick={() => saveTargetChoice.onChange(v)}
                className={`rounded px-2 py-1 font-medium transition-colors ${
                  saveTargetChoice.value === v
                    ? 'bg-[var(--deck-accent)] text-white'
                    : 'text-[var(--deck-text-mid)] hover:text-[var(--deck-text-hi)]'
                }`}
              >
                {v === 'template' ? 'Save as Template' : 'Save as Design'}
              </button>
            ))}
          </div>
        )}
        {saveError && <span className="text-xs text-red-500 dark:text-red-400">{saveError}</span>}
        {!saveError && saveResult && (
          <Link
            href={saveResult.href}
            className="flex items-center gap-1 text-xs text-green-600 hover:underline dark:text-green-400"
          >
            <Check className="h-3.5 w-3.5" />
            Saved as {saveResult.kind === 'template' ? 'Template' : 'Design'} &ldquo;{saveResult.name}&rdquo; · View
          </Link>
        )}
        <SaveStatus status={saveStatus} />
        {/* Preview plays a scene-sequencing loop (designer.md Phase 6) — real, but Designer-only:
            no dynamic variables/animation/video/Player-runtime parity yet (designer.md Phase 11). */}
        <button
          className={btn}
          onClick={onTogglePreview}
          aria-label={previewing ? 'Stop preview' : 'Preview'}
          aria-pressed={previewing}
        >
          {previewing ? <Square className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
        <button
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-white shadow-sm disabled:opacity-30"
          style={{ background: 'linear-gradient(135deg, var(--deck-glow-violet), #8F6CFF 60%, var(--deck-glow-magenta))' }}
          disabled={!onSave || saving}
          onClick={onSave}
          aria-label="Save"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
