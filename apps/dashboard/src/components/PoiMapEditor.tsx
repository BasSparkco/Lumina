'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Rnd } from 'react-rnd';

export interface PoiMapContextPin {
  id: string;
  x: number;
  y: number;
  color?: string;
  label?: string;
}

interface PoiMapEditorProps {
  // null while the floor has no floor-plan image uploaded yet — the canvas still works (a plain
  // dashed placeholder box) since a pin's x/y is meaningful even without a picture to place it on.
  imageUrl: string | null;
  // Other POIs/kiosks on this floor, rendered as small non-interactive dots for spatial context.
  pins?: PoiMapContextPin[];
  // The point this editor actually edits. Null means "not placed yet" — click anywhere on the
  // canvas to drop it there, same first-placement gesture as the zone editor's "click to add".
  activePin: { x: number; y: number } | null;
  onActivePinChange: (x: number, y: number) => void;
  disabled?: boolean;
  activeColor?: string;
  emptyLabel?: string;
}

// Fixed pixel size for the draggable marker — percent-in/percent-out math (see toBox/fromBox
// below) always centers this box on the stored x/y, mirroring how LayoutsSection's getBoxPx
// converts stored zone percentages against the live rendered canvas size, just for a point
// instead of a rectangle.
const MARKER_PX = 26;
const CONTEXT_DOT_PX = 10;

function clampPct(v: number) {
  return Math.max(0, Math.min(100, v));
}

export function PoiMapEditor({
  imageUrl,
  pins = [],
  activePin,
  onActivePinChange,
  disabled,
  activeColor = '#dc2626',
  emptyLabel,
}: PoiMapEditorProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  // Floor plans aren't a fixed aspect ratio like a 16:9 screen — size the canvas to whatever the
  // uploaded image actually is once it loads, falling back to a plausible default before then.
  const [aspect, setAspect] = useState(4 / 3);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);

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

  function handleCanvasClick(e: React.MouseEvent) {
    // Only used to drop the pin the first time — once it exists, dragging the marker itself
    // is the only way to move it, so a stray click elsewhere on the map doesn't relocate it.
    if (disabled || activePin || !canvasSize.width || !canvasSize.height) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    onActivePinChange(
      clampPct(((e.clientX - rect.left) / rect.width) * 100),
      clampPct(((e.clientY - rect.top) / rect.height) * 100),
    );
  }

  const activeBox = activePin ? toBox(dragPos ?? activePin, MARKER_PX) : null;

  return (
    <div
      ref={canvasRef}
      onClick={handleCanvasClick}
      style={{ width: '100%', aspectRatio: String(aspect), position: 'relative', borderRadius: 6, overflow: 'hidden' }}
      className={`${imageUrl ? 'bg-gray-900' : 'flex items-center justify-center border border-dashed border-gray-300 bg-gray-50 dark:border-gray-700 dark:bg-gray-900'} ${!disabled && !activePin ? 'cursor-crosshair' : ''}`}
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

      {canvasSize.width > 0 &&
        pins.map((p) => {
          const box = toBox(p, CONTEXT_DOT_PX);
          return (
            <div
              key={p.id}
              title={p.label}
              style={{
                position: 'absolute',
                left: box.left,
                top: box.top,
                width: CONTEXT_DOT_PX,
                height: CONTEXT_DOT_PX,
                borderRadius: '50%',
                background: p.color ?? '#6366f1',
                border: '1.5px solid white',
                boxShadow: '0 0 0 1px rgba(0,0,0,0.35)',
                pointerEvents: 'none',
              }}
            />
          );
        })}

      {canvasSize.width > 0 && activeBox && (
        <Rnd
          bounds="parent"
          disableDragging={disabled}
          enableResizing={false}
          size={{ width: MARKER_PX, height: MARKER_PX }}
          position={{ x: activeBox.left, y: activeBox.top }}
          onDragStart={(e) => e.stopPropagation()}
          onDrag={(_e, d) => setDragPos(fromBox(d.x, d.y, MARKER_PX))}
          onDragStop={(_e, d) => {
            setDragPos(null);
            onActivePinChange(fromBox(d.x, d.y, MARKER_PX).x, fromBox(d.x, d.y, MARKER_PX).y);
          }}
          style={{ zIndex: 10, cursor: disabled ? 'default' : 'grab' }}
        >
          <div
            style={{
              width: '100%',
              height: '100%',
              borderRadius: '50%',
              background: activeColor,
              border: '3px solid white',
              boxShadow: '0 0 0 1.5px rgba(0,0,0,0.4), 0 2px 6px rgba(0,0,0,0.4)',
            }}
          />
        </Rnd>
      )}
    </div>
  );
}
