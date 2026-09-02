'use client';
import { X, GripVertical } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
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
}

function LayerRow({
  item,
  selected,
  onSelect,
}: {
  item: LayerItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  const Icon = item.icon;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs ${
        isDragging ? 'z-10 opacity-70 shadow-lg' : ''
      } ${
        selected
          ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300'
          : 'border-transparent text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800'
      }`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab touch-none text-gray-400 active:cursor-grabbing dark:text-gray-500"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <button type="button" onClick={onSelect} className="flex flex-1 items-center gap-2 truncate text-left">
        {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
        <span className="flex-1 truncate">{item.label}</span>
        <span className="shrink-0 font-mono text-[10px] text-gray-400 dark:text-gray-500">
          {item.zIndex}
        </span>
      </button>
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
}: LayersPanelProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
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
        <div className="px-2 py-6 text-center text-xs text-gray-400 dark:text-gray-500">{emptyLabel}</div>
      )}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={orderedIds} strategy={verticalListSortingStrategy}>
          {items.map((item) => (
            <LayerRow
              key={item.id}
              item={item}
              selected={item.id === selectedId}
              onSelect={() => onSelect(item.id)}
            />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  );

  if (variant === 'inline') return list;

  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/40" onClick={() => onOpenChange(false)} />
      <aside className="fixed inset-y-0 end-0 z-40 flex w-72 flex-col bg-white shadow-lg dark:bg-gray-900">
        <div className="flex items-center justify-between border-b border-gray-100 px-3 py-3 dark:border-gray-800">
          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">{title}</span>
          <button
            onClick={() => onOpenChange(false)}
            title={closeLabel}
            className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {list}
      </aside>
    </>
  );
}
