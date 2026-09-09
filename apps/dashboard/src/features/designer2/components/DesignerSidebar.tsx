'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Braces,
  LayoutTemplate,
  Type,
  Image as ImageIcon,
  Video,
  Shapes,
  QrCode,
  Square,
  RectangleHorizontal,
  Circle,
  Triangle,
  Minus,
} from 'lucide-react';
import type { ShapeKindSchema } from '@lumina/design-schema';
import type { z } from 'zod';

type ShapeKind = z.infer<typeof ShapeKindSchema>;

interface DesignerSidebarProps {
  // Opens (or re-focuses) the Templates tab in the merged InspectorPanel — DesignerShell owns
  // that tab state since it's shared with the Properties tab (auto-switched on selection).
  onShowTemplates: () => void;
  isTemplatesActive?: boolean;
  onAddText: () => void;
  onAddShape: (shape: ShapeKind) => void;
  onInsertImage: () => void;
  onAddQrPlaceholder: () => void;
  onInsertVideo: () => void;
  // Opens (or re-focuses) the Variables tab in the merged InspectorPanel — same pattern as
  // onShowTemplates above.
  onShowVariables: () => void;
  isVariablesActive?: boolean;
}

const tabBtn =
  'flex w-14 flex-col items-center gap-1 rounded-md py-2 text-[10px] text-[var(--deck-text-mid)] hover:bg-[var(--deck-glass-fill-strong)] hover:text-[var(--deck-text-hi)]';
// Colored fill + soft ring, matching the mockups' `.tool.active` treatment.
const tabBtnActive =
  'flex w-14 flex-col items-center gap-1 rounded-md py-2 text-[10px] text-[var(--deck-accent)] bg-[var(--deck-accent-soft)] shadow-[0_0_0_1px_var(--deck-accent-soft)]';

const SHAPE_OPTIONS: { kind: ShapeKind; label: string; icon: typeof Square }[] = [
  { kind: 'rectangle', label: 'Rectangle', icon: RectangleHorizontal },
  { kind: 'rounded-rectangle', label: 'Rounded', icon: Square },
  { kind: 'circle', label: 'Circle', icon: Circle },
  { kind: 'ellipse', label: 'Ellipse', icon: Circle },
  { kind: 'triangle', label: 'Triangle', icon: Triangle },
  { kind: 'line', label: 'Line', icon: Minus },
];

export function DesignerSidebar({
  onShowTemplates,
  isTemplatesActive,
  onAddText,
  onAddShape,
  onInsertImage,
  onAddQrPlaceholder,
  onInsertVideo,
  onShowVariables,
  isVariablesActive,
}: DesignerSidebarProps) {
  const t = useTranslations('designer2Media');
  const [shapesOpen, setShapesOpen] = useState(false);

  return (
    <div className="glass-panel relative flex w-16 shrink-0 flex-col items-center gap-1 rounded-2xl py-3">
      <button className={isTemplatesActive ? tabBtnActive : tabBtn} aria-pressed={isTemplatesActive} onClick={onShowTemplates}>
        <LayoutTemplate className="h-4 w-4" />
        Templates
      </button>

      <button className={tabBtn} onClick={onAddText}>
        <Type className="h-4 w-4" />
        Text
      </button>

      <button className={tabBtn} onClick={onInsertImage}>
        <ImageIcon className="h-4 w-4" />
        {t('image')}
      </button>

      <button className={tabBtn} onClick={onInsertVideo}>
        <Video className="h-4 w-4" />
        {t('video')}
      </button>

      <div className="relative">
        <button className={tabBtn} onClick={() => setShapesOpen((v) => !v)}>
          <Shapes className="h-4 w-4" />
          Shapes
        </button>
        {shapesOpen && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setShapesOpen(false)} />
            <div className="glass-popup absolute start-full top-0 z-40 ml-1 grid grid-cols-3 gap-1 rounded-lg p-2">
              {SHAPE_OPTIONS.map(({ kind, label, icon: Icon }) => (
                <button
                  key={kind}
                  title={label}
                  onClick={() => {
                    onAddShape(kind);
                    setShapesOpen(false);
                  }}
                  className="flex h-12 w-12 flex-col items-center justify-center gap-1 rounded-md text-[var(--deck-text-mid)] hover:bg-[var(--deck-glass-fill-strong)] hover:text-[var(--deck-text-hi)]"
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

      <button className={isVariablesActive ? tabBtnActive : tabBtn} aria-pressed={isVariablesActive} onClick={onShowVariables} title="Design variables (designer.md §17.2)">
        <Braces className="h-4 w-4" />
        Variables
      </button>


    </div>
  );
}
