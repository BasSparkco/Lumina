'use client';
import { useEffect, useRef, useState } from 'react';
import { Copy, GripHorizontal, Image as ImageIcon, Plus, Trash2, Video } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, horizontalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { DesignScene } from '@lumina/design-schema';
import { ContextMenu, type ContextMenuState } from '@/components/ContextMenu';
import { useConfirmBeforeDelete } from '@/hooks/useConfirmBeforeDelete';
import type { FabricCanvasAdapter } from '../canvas/FabricCanvasAdapter';
import { createScene } from '../lib/defaultScene';
import { useDesignerStore } from '../state/designer.store';

interface SceneStripProps {
  // Commit-wrapped by the caller (DesignerShell owns useDesignerHistory) so every scene mutation
  // here is one undo step, same convention as every other panel in this feature.
  commit: (mutator: () => void) => void;
  // Used only to capture a thumbnail of whichever scene is currently loaded into Fabric — see the
  // capture effect below and designer.md Phase 6's amendment on best-effort/session-only thumbnails.
  adapter: FabricCanvasAdapter | null;
}

function SceneThumbnail({ scene, thumbnailUrl }: { scene: DesignScene; thumbnailUrl?: string }) {
  if (thumbnailUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- local blob: object URL, not a static/local image
    return <img src={thumbnailUrl} alt="" className="h-10 w-16 rounded object-cover" />;
  }
  if (scene.background.type === 'color') {
    return <div className="h-10 w-16 rounded" style={{ backgroundColor: scene.background.color }} />;
  }
  const Icon = scene.background.type === 'video' ? Video : ImageIcon;
  return (
    <div className="flex h-10 w-16 items-center justify-center rounded bg-gray-200 dark:bg-gray-800">
      <Icon className="h-4 w-4 text-gray-400 dark:text-gray-500" />
    </div>
  );
}

function SceneTile({
  scene,
  active,
  thumbnailUrl,
  onSelect,
  onRename,
  onDurationChange,
  onContextMenu,
}: {
  scene: DesignScene;
  active: boolean;
  thumbnailUrl?: string;
  onSelect: () => void;
  onRename: (name: string) => void;
  onDurationChange: (durationMs: number) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: scene.id });
  const [renaming, setRenaming] = useState(false);
  const [editingDuration, setEditingDuration] = useState(false);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      className={`flex w-20 shrink-0 flex-col items-center gap-1 rounded-lg border p-1.5 ${isDragging ? 'z-10 opacity-70 shadow-lg' : ''} ${
        active
          ? 'border-indigo-400 bg-indigo-50 dark:border-indigo-600 dark:bg-indigo-950/40'
          : 'border-transparent hover:bg-gray-50 dark:hover:bg-gray-800'
      }`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab touch-none text-gray-300 active:cursor-grabbing dark:text-gray-600"
        aria-label="Drag to reorder"
      >
        <GripHorizontal className="h-3 w-3" />
      </button>

      <SceneThumbnail scene={scene} thumbnailUrl={thumbnailUrl} />

      {renaming ? (
        <input
          autoFocus
          type="text"
          defaultValue={scene.name}
          className="w-full rounded border border-indigo-300 bg-white px-1 text-center text-[11px] text-gray-900 focus:outline-none dark:bg-gray-900 dark:text-gray-100"
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => {
            onRename(e.target.value.trim() || scene.name);
            setRenaming(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') setRenaming(false);
          }}
        />
      ) : (
        <span
          onDoubleClick={(e) => {
            e.stopPropagation();
            setRenaming(true);
          }}
          className="w-full truncate text-center text-[11px] font-medium text-gray-700 dark:text-gray-300"
          title={scene.name}
        >
          {scene.name}
        </span>
      )}

      {editingDuration ? (
        <input
          autoFocus
          type="number"
          min={0.1}
          step={0.5}
          defaultValue={scene.durationMs / 1000}
          className="w-full rounded border border-indigo-300 bg-white px-1 text-center text-[10px] text-gray-900 focus:outline-none dark:bg-gray-900 dark:text-gray-100"
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => {
            const seconds = Number(e.target.value);
            if (seconds > 0) onDurationChange(Math.round(seconds * 1000));
            setEditingDuration(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') setEditingDuration(false);
          }}
        />
      ) : (
        <span
          onClick={(e) => {
            e.stopPropagation();
            setEditingDuration(true);
          }}
          className="text-[10px] tabular-nums text-gray-400 dark:text-gray-500"
        >
          {(scene.durationMs / 1000).toFixed(1)}s
        </span>
      )}
    </div>
  );
}

// designer.md Phase 6 — scene management strip: add/duplicate/rename/delete/reorder scenes, edit
// duration, see a thumbnail per scene. Replaces the old TimelinePanel.tsx placeholder; a future
// Phase 7 may reintroduce a separate per-element timeline alongside this.
export function SceneStrip({ commit, adapter }: SceneStripProps) {
  const document = useDesignerStore((s) => s.document);
  const activeSceneId = useDesignerStore((s) => s.activeSceneId);
  const setActiveScene = useDesignerStore((s) => s.setActiveScene);
  const addScene = useDesignerStore((s) => s.addScene);
  const duplicateScene = useDesignerStore((s) => s.duplicateScene);
  const deleteScene = useDesignerStore((s) => s.deleteScene);
  const reorderScenes = useDesignerStore((s) => s.reorderScenes);
  const updateScene = useDesignerStore((s) => s.updateScene);
  const { confirmDelete } = useConfirmBeforeDelete();

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const thumbnailsRef = useRef(thumbnails);
  useEffect(() => {
    thumbnailsRef.current = thumbnails;
  }, [thumbnails]);
  // Revoke every captured object URL on unmount — not just the latest, since each scene keeps its
  // own cached thumbnail in the map for the life of this component.
  useEffect(
    () => () => {
      Object.values(thumbnailsRef.current).forEach((url) => URL.revokeObjectURL(url));
    },
    [],
  );

  // Only the active scene is ever loaded into Fabric (designer.md §29), so a thumbnail can only be
  // captured for it. Debounced so a burst of edits (e.g. dragging an element) doesn't spam
  // toBlob() on every intermediate frame.
  useEffect(() => {
    if (!adapter || !activeSceneId) return;
    const timer = setTimeout(() => {
      void adapter
        .exportSceneSnapshot()
        .then((blob) => {
          const url = URL.createObjectURL(blob);
          setThumbnails((prev) => {
            const old = prev[activeSceneId];
            if (old) URL.revokeObjectURL(old);
            return { ...prev, [activeSceneId]: url };
          });
        })
        .catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [document, activeSceneId, adapter]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  if (!document) return null;
  const scenes = document.scenes;
  const orderedIds = scenes.map((s) => s.id);

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (over && active.id !== over.id) {
      const oldIndex = orderedIds.indexOf(String(active.id));
      const newIndex = orderedIds.indexOf(String(over.id));
      commit(() => reorderScenes(arrayMove(orderedIds, oldIndex, newIndex)));
    }
  }

  function buildContextMenuActions(scene: DesignScene) {
    return [
      {
        key: 'duplicate',
        label: 'Duplicate Scene',
        icon: Copy,
        onClick: () => {
          commit(() => duplicateScene(scene.id));
          setContextMenu(null);
        },
      },
      {
        key: 'delete',
        label: 'Delete Scene',
        icon: Trash2,
        danger: true,
        disabled: scenes.length === 1,
        separator: true,
        onClick: () => {
          setContextMenu(null);
          if (!confirmDelete(`Delete "${scene.name}"?`)) return;
          commit(() => deleteScene(scene.id));
        },
      },
    ];
  }

  return (
    <div className="flex h-24 shrink-0 items-center gap-2 overflow-x-auto border-t border-gray-200 px-3 dark:border-gray-800">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={orderedIds} strategy={horizontalListSortingStrategy}>
          {scenes.map((scene) => (
            <SceneTile
              key={scene.id}
              scene={scene}
              active={scene.id === activeSceneId}
              thumbnailUrl={thumbnails[scene.id]}
              onSelect={() => setActiveScene(scene.id)}
              onRename={(name) => commit(() => updateScene(scene.id, { name }))}
              onDurationChange={(durationMs) => commit(() => updateScene(scene.id, { durationMs }))}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ x: e.clientX, y: e.clientY, actions: buildContextMenuActions(scene) });
              }}
            />
          ))}
        </SortableContext>
      </DndContext>

      <button
        type="button"
        onClick={() => commit(() => addScene(createScene(document)))}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-dashed border-gray-300 text-gray-400 hover:border-gray-400 hover:text-gray-600 dark:border-gray-700 dark:text-gray-600 dark:hover:border-gray-600 dark:hover:text-gray-400"
        aria-label="Add scene"
      >
        <Plus className="h-4 w-4" />
      </button>

      <ContextMenu state={contextMenu} onClose={() => setContextMenu(null)} />
    </div>
  );
}
