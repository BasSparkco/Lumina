'use client';
import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { X, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { shapeClipStyle, type ThemeElementShape } from '@lumina/types';

export interface MediaCrop {
  cropZoom: number | null;
  cropOffsetX: number | null;
  cropOffsetY: number | null;
}

interface CropEditorProps {
  mediaUrl: string;
  mediaType: 'IMAGE' | 'VIDEO';
  name: string;
  /** The zone/element's own shape — rendered as the frame overlay, matching the real player. */
  shape?: ThemeElementShape;
  /** width / height of the target box, so the preview frame matches its real proportions. */
  aspectRatio: number;
  initialCrop: MediaCrop;
  onClose: () => void;
  onSave: (crop: MediaCrop) => void;
}

const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
const PREVIEW_MAX_W = 420;
const PREVIEW_MAX_H = 420;

// Like cropping a profile picture into a circle frame: drag the media underneath a fixed,
// shape-clipped frame to choose exactly which part is visible, and zoom in for a tighter crop.
// Pan/zoom mechanics (dragRef pattern, range-slider zoom) mirror ImageLightbox.tsx.
export function CropEditor({ mediaUrl, mediaType, name, shape, aspectRatio, initialCrop, onClose, onSave }: CropEditorProps) {
  const t = useTranslations('cropEditor');
  const tc = useTranslations('common');
  const [zoom, setZoom] = useState(initialCrop.cropZoom ?? 1);
  const [pan, setPan] = useState({ x: initialCrop.cropOffsetX ?? 0, y: initialCrop.cropOffsetY ?? 0 });
  // Whether the user has actually touched zoom/pan this session — Save only commits a crop
  // when this is true. Without it, saving with an untouched, crop-less element would still send
  // cropZoom: 1 (the slider's own minimum/default), which is enough to flip mediaCropStyle from
  // "no crop, defer to base objectFit" to a forced 'cover' fit — silently hiding content that
  // 'fill'/'contain' was showing in full, even though the user never asked to crop anything.
  const [dirty, setDirty] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number; w: number; h: number } | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  const previewW = aspectRatio >= 1 ? PREVIEW_MAX_W : PREVIEW_MAX_H * aspectRatio;
  const previewH = aspectRatio >= 1 ? PREVIEW_MAX_W / aspectRatio : PREVIEW_MAX_H;

  function maxPanFor(z: number) {
    return (z - 1) * 50;
  }

  function clampPan(x: number, y: number, z: number) {
    const max = maxPanFor(z);
    return { x: Math.max(-max, Math.min(max, x)), y: Math.max(-max, Math.min(max, y)) };
  }

  function handleMouseDown(e: React.MouseEvent) {
    if (zoom <= 1 || !frameRef.current) return;
    const rect = frameRef.current.getBoundingClientRect();
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y, w: rect.width, h: rect.height };
    setDragging(true);
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!dragRef.current) return;
    const { startX, startY, panX, panY, w, h } = dragRef.current;
    const dx = ((e.clientX - startX) / w) * 100;
    const dy = ((e.clientY - startY) / h) * 100;
    setPan(clampPan(panX + dx, panY + dy, zoom));
    setDirty(true);
  }

  function stopDragging() {
    dragRef.current = null;
    setDragging(false);
  }

  function setZoomClamped(z: number) {
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
    setZoom(next);
    setPan((p) => clampPan(p.x, p.y, next));
    setDirty(true);
  }

  const mediaStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    transform: `translate(${pan.x}%, ${pan.y}%) scale(${zoom})`,
    transition: dragging ? 'none' : 'transform 0.1s ease-out',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6" onClick={onClose}>
      <div
        className="flex max-h-full flex-col items-center gap-4 rounded-xl bg-white p-5 dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex w-full items-center justify-between gap-6">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t('title')}</p>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div
          ref={frameRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={stopDragging}
          onMouseLeave={stopDragging}
          style={{
            width: previewW,
            height: previewH,
            position: 'relative',
            overflow: 'hidden',
            background: '#000',
            cursor: zoom > 1 ? (dragging ? 'grabbing' : 'grab') : 'default',
          }}
        >
          {/* Dimmed, unclipped copy — shows what's outside the frame and gets cut off. */}
          <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', opacity: 0.35 }}>
            {mediaType === 'VIDEO' ? (
              <video src={mediaUrl} autoPlay muted loop playsInline style={mediaStyle} />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- arbitrary remote asset URL, not a static/local image
              <img src={mediaUrl} alt={name} draggable={false} style={mediaStyle} />
            )}
          </div>
          {/* Sharp, shape-clipped copy — exactly what the real render will show. */}
          <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', ...shapeClipStyle(shape) }}>
            {mediaType === 'VIDEO' ? (
              <video src={mediaUrl} autoPlay muted loop playsInline style={mediaStyle} />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- arbitrary remote asset URL, not a static/local image
              <img src={mediaUrl} alt={name} draggable={false} style={mediaStyle} />
            )}
          </div>
        </div>

        <p className="text-xs text-gray-400 dark:text-gray-500">{t('dragHint')}</p>

        <div className="flex w-full items-center gap-3">
          <button onClick={() => setZoomClamped(zoom - 0.25)} className="text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">
            <ZoomOut className="h-4 w-4" />
          </button>
          <input
            type="range"
            min={ZOOM_MIN}
            max={ZOOM_MAX}
            step={0.05}
            value={zoom}
            onChange={(e) => setZoomClamped(parseFloat(e.target.value))}
            className="flex-1 accent-indigo-500"
          />
          <button onClick={() => setZoomClamped(zoom + 0.25)} className="text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">
            <ZoomIn className="h-4 w-4" />
          </button>
          <span className="w-10 text-center text-xs tabular-nums text-gray-500 dark:text-gray-400">{Math.round(zoom * 100)}%</span>
        </div>

        <div className="flex w-full items-center justify-between gap-2 pt-1">
          <button
            onClick={() => onSave({ cropZoom: null, cropOffsetX: null, cropOffsetY: null })}
            className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
          >
            <RotateCcw className="h-3.5 w-3.5" /> {t('resetToFull')}
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              {tc('cancel')}
            </button>
            <button
              onClick={() => onSave(dirty ? { cropZoom: zoom, cropOffsetX: pan.x, cropOffsetY: pan.y } : initialCrop)}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
            >
              {tc('save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
