'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  Copy,
  Crop as CropIcon,
  FlipHorizontal,
  FlipVertical,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import type { DesignElement } from '@lumina/design-schema';
import { FontPicker } from '@/components/FontPicker';
import { ImagePicker } from '@/components/ImagePicker';
import { CropEditor } from '@/components/CropEditor';
import { AdjustmentsEditor } from '@/components/AdjustmentsEditor';
import { assetsApi } from '@/lib/api';
import { useConfirmBeforeDelete } from '@/hooks/useConfirmBeforeDelete';
import type { FabricCanvasAdapter } from '../canvas/FabricCanvasAdapter';
import { useLiveField } from '../hooks/useLiveField';
import { useDesignerStore } from '../state/designer.store';

// designer2 hasn't adopted next-intl yet (see PropertiesPanel's other hardcoded strings below) —
// ImagePicker's `labels` prop is required, so English literals stand in until the rest of the
// feature is wired for i18n rather than half-translating just this one panel.
const IMAGE_PICKER_LABELS = {
  existing: 'Existing',
  upload: 'Upload',
  paste: 'Paste',
  stock: 'Stock',
  uploading: 'Uploading',
  uploadFailed: 'Upload failed',
  pasteHint: 'Click and paste an image',
  pasteError: 'Clipboard did not contain an image',
  removeBackground: 'Remove background',
  removingBackground: 'Removing background',
  removeBackgroundFailed: 'Background removal failed',
  stockSearchPlaceholder: 'Search stock photos',
  stockEmpty: 'No results',
  stockNotConfigured: 'Stock photos are not configured',
  stockCredit: 'Photos provided by Pexels',
  importStockFailed: 'Could not import photo',
};

interface PropertiesPanelProps {
  // Live-feedback writes (designer.md §8 amendment) go straight to the adapter, bypassing the
  // store/canvas-rebuild round-trip; only the final value is committed to the store on blur.
  adapter: FabricCanvasAdapter | null;
  commit: (mutator: () => void) => void;
  // designer.md §7/Phase 5 — when true, exposes the two TemplateLayerPolicy axes
  // (styleEditable/contentEditable) alongside the geometry capability flags below. Only
  // meaningful while authoring a Template (DesignerShell's templateId set); a plain customer
  // design has no template policy at all.
  isTemplateMode?: boolean;
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-72 shrink-0 space-y-4 overflow-y-auto border-l border-gray-200 p-4 dark:border-gray-800">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-600">Properties</h3>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-gray-500 dark:text-gray-400">{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  'w-full rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-900 focus:border-indigo-400 focus:outline-none disabled:opacity-40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

function NumberField({
  label,
  value,
  onLive,
  onCommit,
  disabled,
}: {
  label: string;
  value: number;
  onLive: (v: number) => void;
  onCommit: (v: number) => void;
  disabled?: boolean;
}) {
  const field = useLiveField(value, onLive, onCommit);
  return (
    <Field label={label}>
      <input
        type="number"
        className={inputClass}
        disabled={disabled}
        value={Math.round(field.value * 100) / 100}
        onChange={(e) => field.onChange(Number(e.target.value))}
        onBlur={field.onBlur}
      />
    </Field>
  );
}

function ColorField({ label, value, onCommit }: { label: string; value: string; onCommit: (v: string) => void }) {
  return (
    <Field label={label}>
      <input type="color" className="h-7 w-full rounded-md border border-gray-200 dark:border-gray-700" value={value} onChange={(e) => onCommit(e.target.value)} />
    </Field>
  );
}

function ToggleField({ label, checked, onCommit }: { label: string; checked: boolean; onCommit: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-300">
      {label}
      <input type="checkbox" checked={checked} onChange={(e) => onCommit(e.target.checked)} className="h-3.5 w-3.5" />
    </label>
  );
}

function AlignmentRow({ onAlign }: { onAlign: (axis: 'left' | 'center-h' | 'right' | 'top' | 'middle' | 'bottom') => void }) {
  const btn = 'flex h-7 w-7 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100';
  return (
    <div>
      <span className="mb-1 block text-[11px] font-medium text-gray-500 dark:text-gray-400">Align to canvas</span>
      <div className="flex gap-1">
        <button title="Align left" className={btn} onClick={() => onAlign('left')}><AlignHorizontalJustifyStart className="h-4 w-4" /></button>
        <button title="Align center" className={btn} onClick={() => onAlign('center-h')}><AlignHorizontalJustifyCenter className="h-4 w-4" /></button>
        <button title="Align right" className={btn} onClick={() => onAlign('right')}><AlignHorizontalJustifyEnd className="h-4 w-4" /></button>
        <button title="Align top" className={btn} onClick={() => onAlign('top')}><AlignVerticalJustifyStart className="h-4 w-4" /></button>
        <button title="Align middle" className={btn} onClick={() => onAlign('middle')}><AlignVerticalJustifyCenter className="h-4 w-4" /></button>
        <button title="Align bottom" className={btn} onClick={() => onAlign('bottom')}><AlignVerticalJustifyEnd className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

export function PropertiesPanel({ adapter, commit, isTemplateMode }: PropertiesPanelProps) {
  const document = useDesignerStore((s) => s.document);
  const activeSceneId = useDesignerStore((s) => s.activeSceneId);
  const selectedElementIds = useDesignerStore((s) => s.selectedElementIds);
  const updateElement = useDesignerStore((s) => s.updateElement);
  const removeElements = useDesignerStore((s) => s.removeElements);
  const duplicateElements = useDesignerStore((s) => s.duplicateElements);
  const { confirmDelete } = useConfirmBeforeDelete();
  const { data: assets = [] } = useQuery({ queryKey: ['assets'], queryFn: assetsApi.list });
  const [cropOpen, setCropOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  // Unlike the rest of this panel's per-element inputs (which live under `<Panel key={element.id}>`
  // and so naturally remount on selection change), these two flags are declared on this
  // component itself — reset them during render (React's documented "adjusting state when a prop
  // changes" pattern, not an effect) so a still-open Crop/Adjust modal doesn't silently follow the
  // selection to a different element.
  const selectionKey = selectedElementIds.join(',');
  const [lastSelectionKey, setLastSelectionKey] = useState(selectionKey);
  if (selectionKey !== lastSelectionKey) {
    setLastSelectionKey(selectionKey);
    setCropOpen(false);
    setAdjustOpen(false);
  }

  const scene = document?.scenes.find((s) => s.id === activeSceneId);
  const selectedElements = (scene?.elements ?? []).filter((el) => selectedElementIds.includes(el.id));
  const canvasSize = document?.canvas ?? { width: 1920, height: 1080 };

  function alignSelection(axis: 'left' | 'center-h' | 'right' | 'top' | 'middle' | 'bottom') {
    commit(() => {
      for (const el of selectedElements) {
        const patch: Partial<DesignElement> =
          axis === 'left'
            ? { x: 0 }
            : axis === 'center-h'
              ? { x: (canvasSize.width - el.width) / 2 }
              : axis === 'right'
                ? { x: canvasSize.width - el.width }
                : axis === 'top'
                  ? { y: 0 }
                  : axis === 'middle'
                    ? { y: (canvasSize.height - el.height) / 2 }
                    : { y: canvasSize.height - el.height };
        updateElement(el.id, patch);
        adapter?.updateElement(el.id, patch);
      }
    });
  }

  if (selectedElements.length === 0) {
    return (
      <Panel>
        <p className="text-sm text-gray-400 dark:text-gray-600">Select an element</p>
      </Panel>
    );
  }

  if (selectedElements.length > 1) {
    return (
      <Panel>
        <p className="text-sm text-gray-500 dark:text-gray-400">{selectedElements.length} selected</p>
        <AlignmentRow onAlign={alignSelection} />
        <div className="flex gap-2 pt-2">
          <button
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-gray-200 py-1.5 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            onClick={() => commit(() => duplicateElements(selectedElementIds))}
          >
            <Copy className="h-3.5 w-3.5" /> Duplicate
          </button>
          <button
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-red-200 py-1.5 text-xs text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/30"
            onClick={() => {
              if (confirmDelete(`Delete ${selectedElements.length} elements?`)) commit(() => removeElements(selectedElementIds));
            }}
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
        </div>
      </Panel>
    );
  }

  const element = selectedElements[0]!;
  const liveUpdate = (patch: Partial<DesignElement>) => adapter?.updateElement(element.id, patch);
  const commitUpdate = (patch: Partial<DesignElement>) => commit(() => updateElement(element.id, patch));

  return (
    <Panel key={element.id}>
      <Field label="Name">
        <input
          type="text"
          className={inputClass}
          defaultValue={element.name}
          onBlur={(e) => commitUpdate({ name: e.target.value })}
        />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <NumberField label="X" value={element.x} disabled={!element.movable} onLive={(v) => liveUpdate({ x: v })} onCommit={(v) => commitUpdate({ x: v })} />
        <NumberField label="Y" value={element.y} disabled={!element.movable} onLive={(v) => liveUpdate({ y: v })} onCommit={(v) => commitUpdate({ y: v })} />
        <NumberField label="Width" value={element.width} disabled={!element.resizable} onLive={(v) => liveUpdate({ width: v })} onCommit={(v) => commitUpdate({ width: v })} />
        <NumberField label="Height" value={element.height} disabled={!element.resizable} onLive={(v) => liveUpdate({ height: v })} onCommit={(v) => commitUpdate({ height: v })} />
        <NumberField label="Rotation" value={element.rotation} disabled={!element.resizable} onLive={(v) => liveUpdate({ rotation: v })} onCommit={(v) => commitUpdate({ rotation: v })} />
        <NumberField
          label="Opacity"
          value={element.opacity}
          onLive={(v) => liveUpdate({ opacity: Math.min(1, Math.max(0, v)) })}
          onCommit={(v) => commitUpdate({ opacity: Math.min(1, Math.max(0, v)) })}
        />
      </div>

      <AlignmentRow onAlign={alignSelection} />

      <div className="space-y-1.5 border-t border-gray-100 pt-3 dark:border-gray-800">
        <ToggleField label="Visible" checked={element.visible} onCommit={(v) => commitUpdate({ visible: v })} />
        <ToggleField label="Movable" checked={element.movable} onCommit={(v) => commitUpdate({ movable: v })} />
        <ToggleField label="Resizable" checked={element.resizable} onCommit={(v) => commitUpdate({ resizable: v })} />
        <ToggleField label="Deletable" checked={element.deletable} onCommit={(v) => commitUpdate({ deletable: v })} />
      </div>

      {isTemplateMode && (
        <div className="space-y-1.5 border-t border-gray-100 pt-3 dark:border-gray-800">
          <p className="text-[11px] font-medium text-gray-400 dark:text-gray-600">Template customization (designer.md §7)</p>
          <ToggleField
            label="Content editable by customer"
            checked={element.templatePolicy?.contentEditable ?? false}
            onCommit={(v) => commitUpdate({ templatePolicy: { styleEditable: element.templatePolicy?.styleEditable ?? false, contentEditable: v } })}
          />
          <ToggleField
            label="Style editable by customer"
            checked={element.templatePolicy?.styleEditable ?? false}
            onCommit={(v) => commitUpdate({ templatePolicy: { contentEditable: element.templatePolicy?.contentEditable ?? false, styleEditable: v } })}
          />
        </div>
      )}

      {element.type === 'text' && (
        <div className="space-y-2 border-t border-gray-100 pt-3 dark:border-gray-800">
          <Field label="Text">
            <textarea
              className={inputClass}
              rows={2}
              defaultValue={element.text}
              onBlur={(e) => commitUpdate({ text: e.target.value })}
            />
          </Field>
          <Field label="Font">
            <FontPicker value={element.fontFamily} onChange={(id) => commitUpdate({ fontFamily: id })} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Size" value={element.fontSize} onLive={(v) => liveUpdate({ fontSize: v })} onCommit={(v) => commitUpdate({ fontSize: v })} />
            <ColorField label="Color" value={element.fill} onCommit={(v) => commitUpdate({ fill: v })} />
          </div>
          <Field label="Align">
            <select className={inputClass} value={element.textAlign} onChange={(e) => commitUpdate({ textAlign: e.target.value as 'left' | 'center' | 'right' })}>
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </Field>
          <Field label="Direction">
            <select className={inputClass} value={element.direction} onChange={(e) => commitUpdate({ direction: e.target.value as 'ltr' | 'rtl' })}>
              <option value="ltr">LTR</option>
              <option value="rtl">RTL</option>
            </select>
          </Field>
        </div>
      )}

      {element.type === 'shape' && (
        <div className="space-y-2 border-t border-gray-100 pt-3 dark:border-gray-800">
          <ColorField label="Fill" value={element.fill ?? '#6366f1'} onCommit={(v) => commitUpdate({ fill: v })} />
          <ColorField label="Stroke" value={element.stroke ?? '#000000'} onCommit={(v) => commitUpdate({ stroke: v })} />
          <NumberField label="Stroke Width" value={element.strokeWidth ?? 0} onLive={(v) => liveUpdate({ strokeWidth: v })} onCommit={(v) => commitUpdate({ strokeWidth: v })} />
          {element.shape === 'rounded-rectangle' && (
            <NumberField label="Corner Radius" value={element.radius ?? 0} onLive={(v) => liveUpdate({ radius: v })} onCommit={(v) => commitUpdate({ radius: v })} />
          )}
        </div>
      )}

      {element.type === 'image' && (
        <div className="space-y-2 border-t border-gray-100 pt-3 dark:border-gray-800">
          <Field label="Image">
            <ImagePicker
              value={element.assetId ?? null}
              onChange={(assetId) => commitUpdate({ assetId: assetId ?? undefined })}
              placeholder="No image selected"
              labels={IMAGE_PICKER_LABELS}
            />
          </Field>
          <Field label="Fit">
            <select className={inputClass} value={element.fit} onChange={(e) => commitUpdate({ fit: e.target.value as 'contain' | 'cover' | 'fill' })}>
              <option value="contain">Contain</option>
              <option value="cover">Cover</option>
              <option value="fill">Fill</option>
            </select>
          </Field>
          <div className="flex gap-2">
            <button
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md border py-1.5 text-xs ${element.flipX ? 'border-indigo-400 text-indigo-600' : 'border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300'}`}
              onClick={() => commitUpdate({ flipX: !element.flipX })}
            >
              <FlipHorizontal className="h-3.5 w-3.5" /> Flip X
            </button>
            <button
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md border py-1.5 text-xs ${element.flipY ? 'border-indigo-400 text-indigo-600' : 'border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300'}`}
              onClick={() => commitUpdate({ flipY: !element.flipY })}
            >
              <FlipVertical className="h-3.5 w-3.5" /> Flip Y
            </button>
          </div>
          <div className="flex gap-2">
            <button
              disabled={!element.assetId}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-gray-200 py-1.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              onClick={() => setCropOpen(true)}
            >
              <CropIcon className="h-3.5 w-3.5" /> Crop
            </button>
            <button
              disabled={!element.assetId}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-gray-200 py-1.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              onClick={() => setAdjustOpen(true)}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" /> Adjust
            </button>
          </div>

          {cropOpen &&
            element.assetId &&
            (() => {
              const asset = assets.find((a) => a.id === element.assetId);
              if (!asset?.url) return null;
              return (
                <CropEditor
                  mediaUrl={asset.url}
                  mediaType="IMAGE"
                  name={element.name}
                  aspectRatio={element.width / element.height}
                  initialCrop={{
                    cropZoom: element.cropZoom ?? null,
                    cropOffsetX: element.cropOffsetX ?? null,
                    cropOffsetY: element.cropOffsetY ?? null,
                  }}
                  onClose={() => setCropOpen(false)}
                  onSave={(crop) => {
                    commitUpdate({
                      cropZoom: crop.cropZoom ?? undefined,
                      cropOffsetX: crop.cropOffsetX ?? undefined,
                      cropOffsetY: crop.cropOffsetY ?? undefined,
                    });
                    setCropOpen(false);
                  }}
                />
              );
            })()}

          {adjustOpen && element.assetId && (
            <AdjustmentsEditor
              mediaUrl={assets.find((a) => a.id === element.assetId)?.url ?? ''}
              name={element.name}
              initial={element.adjustments}
              onClose={() => setAdjustOpen(false)}
              onSave={(adjustments) => {
                commitUpdate({ adjustments });
                setAdjustOpen(false);
              }}
            />
          )}
        </div>
      )}

      {element.type === 'qr' && (
        <div className="space-y-2 border-t border-gray-100 pt-3 dark:border-gray-800">
          <Field label="Value">
            <input type="text" className={inputClass} defaultValue={element.value ?? ''} onBlur={(e) => commitUpdate({ value: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <ColorField label="Foreground" value={element.foregroundColor} onCommit={(v) => commitUpdate({ foregroundColor: v })} />
            <ColorField label="Background" value={element.backgroundColor} onCommit={(v) => commitUpdate({ backgroundColor: v })} />
          </div>
          <p className="text-[11px] text-gray-400 dark:text-gray-600">Dynamic binding — designer.md Phase 8</p>
        </div>
      )}

      <div className="flex gap-2 border-t border-gray-100 pt-3 dark:border-gray-800">
        <button
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-gray-200 py-1.5 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          onClick={() => commit(() => duplicateElements([element.id]))}
        >
          <Copy className="h-3.5 w-3.5" /> Duplicate
        </button>
        <button
          disabled={!element.deletable}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-red-200 py-1.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-40 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/30"
          onClick={() => {
            if (confirmDelete('Delete this element?')) commit(() => removeElements([element.id]));
          }}
        >
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </button>
      </div>
    </Panel>
  );
}
