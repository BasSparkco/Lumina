'use client';
import { useState } from 'react';
import {
  Braces,
  LayoutTemplate,
  Type,
  Image as ImageIcon,
  Video,
  Shapes,
  QrCode,
  Upload,
  Square,
  RectangleHorizontal,
  Circle,
  Triangle,
  Minus,
} from 'lucide-react';
import type { ShapeKindSchema } from '@lumina/design-schema';
import type { z } from 'zod';
import { TemplatesGalleryPanel } from './TemplatesGalleryPanel';

type ShapeKind = z.infer<typeof ShapeKindSchema>;

interface DesignerSidebarProps {
  onAddText: () => void;
  onAddShape: (shape: ShapeKind) => void;
  onAddImagePlaceholder: () => void;
  onAddQrPlaceholder: () => void;
  onAddVideoPlaceholder: () => void;
  onToggleVariables: () => void;
}

const tabBtn =
  'flex w-14 flex-col items-center gap-1 rounded-md py-2 text-[10px] text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100';
const disabledTabBtn = 'flex w-14 flex-col items-center gap-1 rounded-md py-2 text-[10px] text-gray-300 dark:text-gray-700';

const SHAPE_OPTIONS: { kind: ShapeKind; label: string; icon: typeof Square }[] = [
  { kind: 'rectangle', label: 'Rectangle', icon: RectangleHorizontal },
  { kind: 'rounded-rectangle', label: 'Rounded', icon: Square },
  { kind: 'circle', label: 'Circle', icon: Circle },
  { kind: 'ellipse', label: 'Ellipse', icon: Circle },
  { kind: 'triangle', label: 'Triangle', icon: Triangle },
  { kind: 'line', label: 'Line', icon: Minus },
];

export function DesignerSidebar({
  onAddText,
  onAddShape,
  onAddImagePlaceholder,
  onAddQrPlaceholder,
  onAddVideoPlaceholder,
  onToggleVariables,
}: DesignerSidebarProps) {
  const [shapesOpen, setShapesOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);

  return (
    <div className="relative flex w-16 shrink-0 flex-col items-center gap-1 border-r border-gray-200 py-3 dark:border-gray-800">
      <button className={tabBtn} onClick={() => setTemplatesOpen(true)}>
        <LayoutTemplate className="h-4 w-4" />
        Templates
      </button>
      {templatesOpen && <TemplatesGalleryPanel onClose={() => setTemplatesOpen(false)} />}

      <button className={tabBtn} onClick={onAddText}>
        <Type className="h-4 w-4" />
        Text
      </button>

      <button className={tabBtn} onClick={onAddImagePlaceholder}>
        <ImageIcon className="h-4 w-4" />
        Images
      </button>

      <button className={tabBtn} onClick={onAddVideoPlaceholder}>
        <Video className="h-4 w-4" />
        Video
      </button>

      <div className="relative">
        <button className={tabBtn} onClick={() => setShapesOpen((v) => !v)}>
          <Shapes className="h-4 w-4" />
          Shapes
        </button>
        {shapesOpen && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setShapesOpen(false)} />
            <div className="absolute start-full top-0 z-40 ml-1 grid grid-cols-3 gap-1 rounded-lg border border-gray-200 bg-white p-2 shadow-lg dark:border-gray-800 dark:bg-gray-900">
              {SHAPE_OPTIONS.map(({ kind, label, icon: Icon }) => (
                <button
                  key={kind}
                  title={label}
                  onClick={() => {
                    onAddShape(kind);
                    setShapesOpen(false);
                  }}
                  className="flex h-12 w-12 flex-col items-center justify-center gap-1 rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
                >
                  <Icon className="h-4 w-4" />
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <button className={tabBtn} onClick={onAddQrPlaceholder}>
        <QrCode className="h-4 w-4" />
        QR
      </button>

      <button className={tabBtn} onClick={onToggleVariables} title="Design variables (designer.md §17.2)">
        <Braces className="h-4 w-4" />
        Variables
      </button>

      {/* Phase 4 wired media browse/upload/replace into the Image element's own Properties panel
          (ImagePicker's "existing"/"upload"/"paste"/"stock" tabs), not a separate sidebar tab —
          a standalone media-library browser stays a deferred nice-to-have. */}
      <button disabled title="Uploads — coming soon" className={disabledTabBtn}>
        <Upload className="h-4 w-4" />
        Uploads
      </button>
    </div>
  );
}
