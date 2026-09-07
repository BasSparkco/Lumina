'use client';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { X, Trash2, ZoomIn, ZoomOut, Download, AudioLines } from 'lucide-react';

interface ImageLightboxProps {
  name: string;
  imageUrl: string;
  sizeLabel?: string;
  typeLabel?: string;
  canEdit: boolean;
  onClose: () => void;
  /** Only passed by the Assets page — renaming isn't available from a playlist context. */
  onRename?: (newName: string) => void;
  deleteLabel: string;
  onDelete: () => void;
  downloadUrl?: string | null;
  downloadLabel?: string;
  /** Only passed by the Assets page, and only for VIDEO assets with a detected audio track — converts this video into a new, separate AUDIO asset. */
  onConvertToAudio?: () => void;
  convertToAudioLabel?: string;
  convertToAudioBusy?: boolean;
}

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;

export function ImageLightbox({ name, imageUrl, sizeLabel, typeLabel, canEdit, onClose, onRename, deleteLabel, onDelete, downloadUrl, downloadLabel, onConvertToAudio, convertToAudioLabel, convertToAudioBusy }: ImageLightboxProps) {
  const tc = useTranslations('common');
  const isVideo = typeLabel === 'VIDEO';
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [nameValue, setNameValue] = useState(name);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function handleMouseDown(e: React.MouseEvent) {
    if (zoom <= 1) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
    setDragging(true);
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!dragRef.current) return;
    setPan({ x: dragRef.current.panX + (e.clientX - dragRef.current.startX), y: dragRef.current.panY + (e.clientY - dragRef.current.startY) });
  }

  function stopDragging() {
    dragRef.current = null;
    setDragging(false);
  }

  function setZoomClamped(z: number) {
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
    setZoom(next);
    if (next <= 1) setPan({ x: 0, y: 0 });
  }

  function commitRename() {
    const trimmed = nameValue.trim();
    if (trimmed && trimmed !== name) onRename?.(trimmed);
    else setNameValue(name);
    setRenaming(false);
  }

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex" onClick={onClose}>
      {/* Media area */}
      <div
        className="flex-1 relative flex items-center justify-center overflow-hidden"
        onClick={e => e.stopPropagation()}
        onMouseDown={isVideo ? undefined : handleMouseDown}
        onMouseMove={isVideo ? undefined : handleMouseMove}
        onMouseUp={isVideo ? undefined : stopDragging}
        onMouseLeave={isVideo ? undefined : stopDragging}
        style={{ cursor: !isVideo && zoom > 1 ? (dragging ? 'grabbing' : 'grab') : 'default' }}>
        {isVideo ? (
          <video src={imageUrl} controls autoPlay className="max-w-[90%] max-h-[90%]" />
        ) : (
          <img
            src={imageUrl}
            alt={name}
            draggable={false}
            className="max-w-[90%] max-h-[90%] select-none"
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transition: dragging ? 'none' : 'transform 0.1s ease-out' }}
          />
        )}

        {/* Zoom toolbar — doesn't apply to video, which has its own native controls */}
        {!isVideo && (
          <div className="absolute bottom-5 left-1/2 -translate-x-1/2 bg-black/60 rounded-full px-4 py-2 flex items-center gap-3">
            <button onClick={() => setZoomClamped(zoom - 0.25)} className="text-white/80 hover:text-white">
              <ZoomOut className="w-4 h-4" />
            </button>
            <input type="range" min={ZOOM_MIN} max={ZOOM_MAX} step={0.05} value={zoom}
              onChange={e => setZoomClamped(parseFloat(e.target.value))}
              className="w-40 accent-[var(--deck-accent)]" />
            <button onClick={() => setZoomClamped(zoom + 0.25)} className="text-white/80 hover:text-white">
              <ZoomIn className="w-4 h-4" />
            </button>
            <span className="text-white text-xs w-10 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
          </div>
        )}

        <button onClick={onClose} className="absolute top-4 end-4 text-white/70 hover:text-white">
          <X className="w-6 h-6" />
        </button>
      </div>

      {/* Side panel */}
      <div className="w-72 glass-popup flex flex-col shrink-0" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-[var(--deck-glass-border-soft)]">
          {renaming ? (
            <input autoFocus value={nameValue} onChange={e => setNameValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') { setNameValue(name); setRenaming(false); } }}
              className="w-full text-sm font-semibold text-[var(--deck-text-hi)] border border-[var(--deck-accent)] rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[var(--deck-accent)]" />
          ) : (
            <p onClick={() => canEdit && onRename && setRenaming(true)}
              title={canEdit && onRename ? tc('clickToRename') : undefined}
              className={`text-sm font-semibold text-[var(--deck-text-hi)] break-words ${canEdit && onRename ? 'cursor-text hover:text-[var(--deck-accent)]' : ''}`}>
              {name}
            </p>
          )}
        </div>

        {(typeLabel ?? sizeLabel) && (
          <div className="p-5 space-y-1.5 text-xs text-[var(--deck-text-mid)] border-b border-[var(--deck-glass-border-soft)]">
            {typeLabel && <p><span className="text-[var(--deck-text-low)]">{tc('type')}: </span>{typeLabel}</p>}
            {sizeLabel && <p><span className="text-[var(--deck-text-low)]">{tc('size')}: </span>{sizeLabel}</p>}
          </div>
        )}

        {(downloadUrl ?? canEdit ?? onConvertToAudio) && (
        <div className="p-5 mt-auto space-y-2">
          {downloadUrl && (
            <a href={downloadUrl}
              className="w-full flex items-center justify-center gap-2 border border-[var(--deck-glass-border)] text-[var(--deck-text-hi)] py-2 rounded-lg text-sm font-medium hover:bg-[var(--deck-glass-fill-strong)]">
              <Download className="w-4 h-4" /> {downloadLabel}
            </a>
          )}
          {onConvertToAudio && (
            <button onClick={onConvertToAudio} disabled={convertToAudioBusy}
              className="w-full flex items-center justify-center gap-2 border border-[var(--deck-glass-border)] text-[var(--deck-text-hi)] py-2 rounded-lg text-sm font-medium hover:bg-[var(--deck-glass-fill-strong)] disabled:opacity-50">
              <AudioLines className="w-4 h-4" /> {convertToAudioLabel}
            </button>
          )}
          {canEdit && (
            <button onClick={onDelete}
              className="w-full flex items-center justify-center gap-2 border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 py-2 rounded-lg text-sm font-medium hover:bg-red-50 dark:hover:bg-red-950/40">
              <Trash2 className="w-4 h-4" /> {deleteLabel}
            </button>
          )}
        </div>
        )}
      </div>
    </div>
  );
}
