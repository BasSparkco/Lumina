'use client';
import { useCallback, useState } from 'react';
import { X, GripVertical, Eye, EyeOff, Lock, LockOpen, MoreVertical } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

export interface LayerItem {
  id: string;
  zIndex: number;
  label: string;
  icon?: LucideIcon;
  // Row-level state for the optional visibility/lock toggles below — undefined (the legacy
  // Themes/Layouts modal usages) simply renders no toggle for that row.
  visible?: boolean;
  locked?: boolean;
}

interface LayersPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Must already be ordered front-to-back (highest zIndex first) — e.g. via `sortByZDesc`.
  items: LayerItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  // Called with the new front-to-back id order once a drag settles.
  onReorder: (orderedIdsFrontToBack: string[]) => void;
  title: string;
  emptyLabel: string;
  closeLabel: string;
  // 'modal' (default) is the original toggled-overlay treatment — backdrop + fixed drawer —
  // used by the legacy Designer's Themes/Layouts editors. 'inline' drops the backdrop, fixed
  // positioning and header, and just renders the list to fill its container: designer2's
  // InspectorPanel docks this as one of its own tabs, where the tab bar already supplies the
  // label and a shared close button.
  variant?: 'modal' | 'inline';
  // designer2's merged Objects tab (layers + properties, designer.md follow-up) — when an item's
  // id matches `expandedId`, `renderExpanded` is rendered directly beneath that row inside an
  // animated accordion instead of the caller having to fork this list. Neither prop is set by the
  // legacy Themes/Layouts modal usages, so they're unaffected.
  expandedId?: string | null;
  renderExpanded?: (item: LayerItem) => React.ReactNode;
  // M4 layer-panel discoverability (designer_modernization_plan.md) — each is independently
  // optional; the legacy Themes/Layouts modal usages pass none of these and render exactly as
  // before (drag handle, icon, label, zIndex — no toggle/rename/actions affordances at all).
  onToggleVisibility?: (id: string) => void;
  onToggleLock?: (id: string) => void;
  onRename?: (id: string, name: string) => void;
  // Anchored at the clicked button's own position — the caller owns wherever it renders its
  // actions popup (e.g. the shared ContextMenu also used for canvas right-click), this only
  // reports "open it here for this row".
  onOpenActions?: (id: string, anchor: DOMRect) => void;
}

function LayerRow({
  item,
  selected,
  expanded,
  onSelect,
  onToggleVisibility,
  onToggleLock,
  onRename,
  onOpenActions,
}: {
  item: LayerItem;
  selected: boolean;
  expanded?: boolean;
  onSelect: () => void;
  onToggleVisibility?: (id: string) => void;
  onToggleLock?: (id: string) => void;
  onRename?: (id: string, name: string) => void;
  onOpenActions?: (id: string, anchor: DOMRect) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  const Icon = item.icon;
  const [renaming, setRenaming] = useState<string | null>(null);
  // A stable (useCallback, empty deps) ref callback, not a `useEffect` keyed on `renaming`'s own
  // value — that value changes on every keystroke (it's also the input's controlled value), so an
  // effect depending on it would re-select-all on every keystroke too, replacing each newly typed
  // character instead of appending it. React re-invokes a ref *callback* whenever its identity
  // changes, not only on mount — an inline (non-memoized) function is a new identity every
  // render, which would reproduce the exact same per-keystroke bug through a different path;
  // `useCallback` keeps this one identity stable so React only calls it once, on mount.
  const focusAndSelectOnMount = useCallback((el: HTMLInputElement | null) => el?.select(), []);

  function commitRename() {
    const trimmed = renaming?.trim();
    if (trimmed && trimmed !== item.label) onRename?.(item.id, trimmed);
    setRenaming(null);
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-1 rounded-md border px-2 py-1.5 text-xs ${
        isDragging ? 'z-10 opacity-70 shadow-lg' : ''
      } ${
        selected
          ? 'border-[var(--deck-accent)] bg-[var(--deck-accent-soft)] text-[var(--deck-accent)]'
          : 'border-transparent text-[var(--deck-text-mid)] hover:bg-[var(--deck-glass-fill-strong)]'
      }`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder — arrow keys also work when focused"
        className="cursor-grab touch-none text-[var(--deck-text-low)] active:cursor-grabbing"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      {renaming !== null ? (
        <input
          ref={focusAndSelectOnMount}
          value={renaming}
          onChange={(e) => setRenaming(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') commitRename();
            else if (e.key === 'Escape') setRenaming(null);
          }}
          className="flex-1 rounded border border-[var(--deck-accent)] bg-[var(--deck-glass-fill-strong)] px-1 py-0.5 text-xs text-[var(--deck-text-hi)] outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={onSelect}
          onDoubleClick={() => onRename && setRenaming(item.label)}
          aria-expanded={expanded}
          className="flex flex-1 items-center gap-2 truncate text-left"
        >
          {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
          <span className="flex-1 truncate">{item.label}</span>
        </button>
      )}
      {onToggleVisibility && (
        <button
          type="button"
          title={item.visible === false ? 'Show' : 'Hide'}
          onClick={() => onToggleVisibility(item.id)}
          className="shrink-0 rounded p-0.5 text-[var(--deck-text-low)] hover:bg-[var(--deck-glass-fill-strong)] hover:text-[var(--deck-text-hi)]"
        >
          {item.visible === false ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
      )}
      {onToggleLock && (
        <button
          type="button"
          title={item.locked ? 'Unlock' : 'Lock'}
          onClick={() => onToggleLock(item.id)}
          className="shrink-0 rounded p-0.5 text-[var(--deck-text-low)] hover:bg-[var(--deck-glass-fill-strong)] hover:text-[var(--deck-text-hi)]"
        >
          {item.locked ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
        </button>
      )}
      {onOpenActions && (
        <button
          type="button"
          title="More actions"
          onClick={(e) => onOpenActions(item.id, e.currentTarget.getBoundingClientRect())}
          className="shrink-0 rounded p-0.5 text-[var(--deck-text-low)] hover:bg-[var(--deck-glass-fill-strong)] hover:text-[var(--deck-text-hi)]"
        >
          <MoreVertical className="h-3.5 w-3.5" />
        </button>
      )}
      <span className="shrink-0 font-mono text-[10px] text-[var(--deck-text-low)]">{item.zIndex}</span>
    </div>
  );
}

// Photoshop-style layer list: top row = front-most (highest zIndex), drag to reorder. A toggled
// overlay rather than a persistent rail (unlike EditorAddSidebar) since it's opened deliberately
// via a toolbar button, so one drawer treatment works at any viewport width.
export function LayersPanel({
  open,
  onOpenChange,
  items,
  selectedId,
  onSelect,
  onReorder,
  title,
  emptyLabel,
  closeLabel,
  variant = 'modal',
  expandedId,
  renderExpanded,
  onToggleVisibility,
  onToggleLock,
  onRename,
  onOpenActions,
}: LayersPanelProps) {
  // KeyboardSensor: with a row's drag handle focused, Space picks it up and arrow keys move it —
  // dnd-kit's own standard keyboard-DnD pattern, so reordering isn't mouse/touch-only.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const orderedIds = items.map((i) => i.id);

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (over && active.id !== over.id) {
      const oldIndex = orderedIds.indexOf(String(active.id));
      const newIndex = orderedIds.indexOf(String(over.id));
      onReorder(arrayMove(orderedIds, oldIndex, newIndex));
    }
  }

  if (!open) return null;

  const list = (
    <div className="flex flex-1 flex-col gap-1 overflow-y-auto p-2">
      {items.length === 0 && (
        <div className="px-2 py-6 text-center text-xs text-[var(--deck-text-low)]">{emptyLabel}</div>
      )}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={orderedIds} strategy={verticalListSortingStrategy}>
          {items.map((item) => (
            <div key={item.id}>
              <LayerRow
                item={item}
                selected={item.id === selectedId}
                expanded={renderExpanded ? item.id === expandedId : undefined}
                onSelect={() => onSelect(item.id)}
                onToggleVisibility={onToggleVisibility}
                onToggleLock={onToggleLock}
                onRename={onRename}
                onOpenActions={onOpenActions}
              />
              {renderExpanded && (
                // CSS grid-rows accordion trick: animating a 0fr <-> 1fr track (rather than
                // max-height, which needs a guessed cap) gives a smooth height transition to
                // "auto" content without measuring it in JS.
                <div
                  className={`grid transition-[grid-template-rows] duration-200 ease-in-out ${
                    item.id === expandedId ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
                  }`}
                >
                  <div className="overflow-hidden">{item.id === expandedId ? renderExpanded(item) : null}</div>
                </div>
              )}
            </div>
          ))}
        </SortableContext>
      </DndContext>
    </div>
  );

  if (variant === 'inline') return list;

  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/40" onClick={() => onOpenChange(false)} />
      <aside className="glass-popup fixed inset-y-0 end-0 z-40 flex w-72 flex-col">
        <div className="flex items-center justify-between border-b border-[var(--deck-glass-border-soft)] px-3 py-3">
          <span className="text-xs font-semibold text-[var(--deck-text-mid)]">{title}</span>
          <button
            onClick={() => onOpenChange(false)}
            title={closeLabel}
            className="text-[var(--deck-text-low)] hover:text-[var(--deck-text-mid)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {list}
      </aside>
    </>
  );
}
