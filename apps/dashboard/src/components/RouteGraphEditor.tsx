'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Rnd } from 'react-rnd';
import type { RouteEdgeType } from '@/lib/api';

export interface RouteGraphNode { id: string; x: number; y: number; label: string | null; }
export interface RouteGraphEdge { id: string; fromNodeId: string; toNodeId: string; type: RouteEdgeType; weight: number; }

export type RouteGraphMode = 'select' | 'addNode' | 'connect';

interface RouteGraphEditorProps {
  imageUrl: string | null;
  // Only nodes/edges belonging to the floor currently shown — edges that leave the floor (an
  // elevator/stairs connection to another floor) aren't drawable as a line here, so the node on
  // this end gets a badge instead (see crossFloorNodeIds).
  nodes: RouteGraphNode[];
  edges: RouteGraphEdge[];
  crossFloorNodeIds: Set<string>;
  mode: RouteGraphMode;
  connectFromId: string | null;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  onAddNode: (x: number, y: number) => void;
  onMoveNode: (id: string, x: number, y: number) => void;
  onSelectNode: (id: string) => void;
  onSelectEdge: (id: string) => void;
  onDeselect: () => void;
  emptyLabel?: string;
}

const NODE_PX = 16;

const EDGE_COLORS: Record<RouteEdgeType, string> = {
  WALK: '#6b7280',
  ELEVATOR: '#7c3aed',
  ESCALATOR: '#0891b2',
  STAIRS: '#d97706',
};

function clampPct(v: number) {
  return Math.max(0, Math.min(100, v));
}

export function RouteGraphEditor({
  imageUrl,
  nodes,
  edges,
  crossFloorNodeIds,
  mode,
  connectFromId,
  selectedNodeId,
  selectedEdgeId,
  onAddNode,
  onMoveNode,
  onSelectNode,
  onSelectEdge,
  onDeselect,
  emptyLabel,
}: RouteGraphEditorProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [aspect, setAspect] = useState(4 / 3);
  const [dragPositions, setDragPositions] = useState<Record<string, { x: number; y: number }>>({});

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const update = () => setCanvasSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const toBox = useCallback(
    (pt: { x: number; y: number }, sizePx: number) => ({
      left: (pt.x / 100) * canvasSize.width - sizePx / 2,
      top: (pt.y / 100) * canvasSize.height - sizePx / 2,
    }),
    [canvasSize],
  );

  const fromBox = useCallback(
    (left: number, top: number, sizePx: number) => ({
      x: clampPct(((left + sizePx / 2) / canvasSize.width) * 100),
      y: clampPct(((top + sizePx / 2) / canvasSize.height) * 100),
    }),
    [canvasSize],
  );

  function pointOf(node: RouteGraphNode) {
    return dragPositions[node.id] ?? node;
  }

  function handleCanvasClick(e: React.MouseEvent) {
    if (mode !== 'addNode') { onDeselect(); return; }
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || !canvasSize.width || !canvasSize.height) return;
    onAddNode(
      clampPct(((e.clientX - rect.left) / rect.width) * 100),
      clampPct(((e.clientY - rect.top) / rect.height) * 100),
    );
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));

  return (
    <div
      ref={canvasRef}
      onClick={handleCanvasClick}
      style={{ width: '100%', aspectRatio: String(aspect), position: 'relative', borderRadius: 6, overflow: 'hidden' }}
      className={`${imageUrl ? 'bg-gray-900' : 'flex items-center justify-center border border-dashed border-gray-300 bg-gray-50 dark:border-gray-700 dark:bg-gray-900'} ${mode === 'addNode' ? 'cursor-crosshair' : ''}`}
    >
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary remote asset URL, not a static/local image
        <img
          src={imageUrl}
          alt=""
          draggable={false}
          onLoad={(e) => {
            const { naturalWidth, naturalHeight } = e.currentTarget;
            if (naturalWidth && naturalHeight) setAspect(naturalWidth / naturalHeight);
          }}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }}
        />
      ) : (
        emptyLabel && <span className="px-4 text-center text-xs text-gray-400 dark:text-gray-500">{emptyLabel}</span>
      )}

      {canvasSize.width > 0 && (
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
          {edges.map((edge) => {
            const from = byId.get(edge.fromNodeId);
            const to = byId.get(edge.toNodeId);
            if (!from || !to) return null;
            const a = pointOf(from);
            const b = pointOf(to);
            const selected = edge.id === selectedEdgeId;
            return (
              <g key={edge.id}>
                {/* Wide invisible hit-line so a thin edge is still easy to click */}
                <line
                  x1={`${a.x}%`} y1={`${a.y}%`} x2={`${b.x}%`} y2={`${b.y}%`}
                  stroke="transparent" strokeWidth={14} style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                  onClick={(e) => { e.stopPropagation(); onSelectEdge(edge.id); }}
                />
                <line
                  x1={`${a.x}%`} y1={`${a.y}%`} x2={`${b.x}%`} y2={`${b.y}%`}
                  stroke={EDGE_COLORS[edge.type]} strokeWidth={selected ? 3.5 : 2}
                  strokeDasharray={edge.type === 'STAIRS' ? '5,3' : undefined}
                  style={{ pointerEvents: 'none' }}
                />
              </g>
            );
          })}
        </svg>
      )}

      {canvasSize.width > 0 &&
        nodes.map((node) => {
          const pt = pointOf(node);
          const box = toBox(pt, NODE_PX);
          const isSelected = node.id === selectedNodeId;
          const isConnectFrom = node.id === connectFromId;
          const hasCrossFloor = crossFloorNodeIds.has(node.id);
          return (
            <Rnd
              key={node.id}
              bounds="parent"
              enableResizing={false}
              size={{ width: NODE_PX, height: NODE_PX }}
              position={{ x: box.left, y: box.top }}
              onDragStart={(e) => e.stopPropagation()}
              onDrag={(_e, d) => setDragPositions((prev) => ({ ...prev, [node.id]: fromBox(d.x, d.y, NODE_PX) }))}
              onDragStop={(_e, d) => {
                const p = fromBox(d.x, d.y, NODE_PX);
                setDragPositions((prev) => { const next = { ...prev }; delete next[node.id]; return next; });
                onMoveNode(node.id, p.x, p.y);
              }}
              style={{ zIndex: isSelected || isConnectFrom ? 11 : 10, cursor: 'grab' }}
            >
              <div
                title={node.label ?? undefined}
                onClick={(e) => { e.stopPropagation(); onSelectNode(node.id); }}
                style={{
                  width: '100%',
                  height: '100%',
                  borderRadius: '50%',
                  background: isConnectFrom ? '#4f46e5' : isSelected ? '#4f46e5' : '#fff',
                  border: `2.5px solid ${isConnectFrom || isSelected ? '#c7d2fe' : '#4f46e5'}`,
                  boxShadow: hasCrossFloor
                    ? '0 0 0 3px rgba(217,119,6,0.55), 0 1px 4px rgba(0,0,0,0.4)'
                    : '0 1px 4px rgba(0,0,0,0.4)',
                }}
              />
            </Rnd>
          );
        })}
    </div>
  );
}
