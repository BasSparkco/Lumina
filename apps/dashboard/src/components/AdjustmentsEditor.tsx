'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { X, RotateCcw } from 'lucide-react';
import {
  IMAGE_ADJUSTMENT_PRESETS,
  buildImageFilterCss,
  needsSvgImageFilter,
  type ThemeImageAdjustments,
} from '@lumina/types';
import { ImageAdjustmentFilter } from '@lumina/ui';

const NEUTRAL: ThemeImageAdjustments = {
  exposure: 0, brightness: 0, contrast: 0, saturation: 0, vibrance: 0,
  temperature: 0, tint: 0, hue: 0, duotone: null,
};

const PRESET_KEYS = Object.keys(IMAGE_ADJUSTMENT_PRESETS);

const SLIDERS: { key: keyof Omit<ThemeImageAdjustments, 'duotone' | 'preset'>; min: number; max: number }[] = [
  { key: 'exposure', min: -100, max: 100 },
  { key: 'brightness', min: -100, max: 100 },
  { key: 'contrast', min: -100, max: 100 },
  { key: 'saturation', min: -100, max: 100 },
  { key: 'vibrance', min: -100, max: 100 },
  { key: 'temperature', min: -100, max: 100 },
  { key: 'tint', min: -100, max: 100 },
  { key: 'hue', min: -180, max: 180 },
];

interface AdjustmentsEditorProps {
  mediaUrl: string;
  name: string;
  initial: ThemeImageAdjustments | undefined;
  onClose: () => void;
  onSave: (adjustments: ThemeImageAdjustments | undefined) => void;
}

// Non-destructive color grading, mirroring CropEditor's full-screen modal pattern: adjustment
// values live entirely in local state until Save, applied as a CSS/SVG filter on a live preview
// — the original asset's pixels are never touched, so every slider can always be dialed back to
// neutral (or the element's imageAdjustments cleared entirely) with nothing lost.
export function AdjustmentsEditor({ mediaUrl, name, initial, onClose, onSave }: AdjustmentsEditorProps) {
  const t = useTranslations('adjustmentsEditor');
  const tc = useTranslations('common');
  const [values, setValues] = useState<ThemeImageAdjustments>(initial ?? NEUTRAL);

  const filterId = 'adjustments-editor-preview';
  const cssFilter = buildImageFilterCss(values);
  const filter = [needsSvgImageFilter(values) ? `url(#${filterId})` : null, cssFilter].filter(Boolean).join(' ') || undefined;
  const isNeutral = JSON.stringify(values) === JSON.stringify(NEUTRAL);

  function set<K extends keyof ThemeImageAdjustments>(key: K, value: ThemeImageAdjustments[K]) {
    setValues((v) => ({ ...v, [key]: value, preset: 'custom' }));
  }

  function applyPreset(key: string) {
    setValues({ ...NEUTRAL, ...IMAGE_ADJUSTMENT_PRESETS[key], preset: key });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6" onClick={onClose}>
      <div
        className="flex max-h-full w-full max-w-3xl flex-col gap-4 overflow-y-auto rounded-xl bg-[var(--deck-glass-fill-strong)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex w-full items-center justify-between gap-6">
          <p className="text-sm font-semibold text-[var(--deck-text-hi)]">{t('title')}</p>
          <button onClick={onClose} className="text-[var(--deck-text-low)] hover:text-[var(--deck-text-hi)]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-col gap-4 sm:flex-row">
          <div
            className="relative mx-auto w-full max-w-xs shrink-0 overflow-hidden rounded-lg bg-black sm:mx-0"
            style={{ aspectRatio: '1' }}
          >
            {needsSvgImageFilter(values) && <ImageAdjustmentFilter id={filterId} adjustments={values} />}
            {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary remote asset URL, not a static/local image */}
            <img src={mediaUrl} alt={name} className="h-full w-full object-contain" style={{ filter }} />
          </div>

          <div className="flex-1 space-y-3">
            <div className="flex flex-wrap gap-1">
              {PRESET_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => applyPreset(key)}
                  className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                    values.preset === key
                      ? 'border-[var(--deck-accent)] bg-[var(--deck-accent-soft)] text-[var(--deck-accent)]'
                      : 'border-[var(--deck-glass-border)] text-[var(--deck-text-mid)] hover:border-[var(--deck-glass-border)]'
                  }`}
                >
                  {t(`presets.${key}`)}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              {SLIDERS.map(({ key, min, max }) => (
                <div key={key}>
                  <div className="mb-0.5 flex items-center justify-between">
                    <label className="text-[10px] text-[var(--deck-text-low)]">{t(`fields.${key}`)}</label>
                    <span className="font-mono text-[9px] text-[var(--deck-text-low)]">{values[key]}</span>
                  </div>
                  <input
                    type="range"
                    min={min}
                    max={max}
                    value={values[key]}
                    onChange={(e) => set(key, parseInt(e.target.value, 10))}
                    className="w-full accent-[var(--deck-accent)]"
                  />
                </div>
              ))}
            </div>

            <div>
              <label className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-[var(--deck-text-mid)]">
                <input
                  type="checkbox"
                  checked={!!values.duotone}
                  onChange={(e) =>
                    setValues((v) => ({
                      ...v,
                      preset: 'custom',
                      duotone: e.target.checked ? { color1: '#1e1b4b', color2: '#fbbf24' } : null,
                    }))
                  }
                />
                {t('duotone')}
              </label>
              {values.duotone && (
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={values.duotone.color1}
                    onChange={(e) => setValues((v) => ({ ...v, preset: 'custom', duotone: { ...v.duotone!, color1: e.target.value } }))}
                    className="h-7 w-7 cursor-pointer rounded border border-[var(--deck-glass-border)]"
                  />
                  <input
                    type="color"
                    value={values.duotone.color2}
                    onChange={(e) => setValues((v) => ({ ...v, preset: 'custom', duotone: { ...v.duotone!, color2: e.target.value } }))}
                    className="h-7 w-7 cursor-pointer rounded border border-[var(--deck-glass-border)]"
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex w-full items-center justify-between gap-2 pt-1">
          <button
            onClick={() => setValues(NEUTRAL)}
            className="flex items-center gap-1.5 text-xs font-medium text-[var(--deck-text-mid)] hover:text-[var(--deck-text-hi)]"
          >
            <RotateCcw className="h-3.5 w-3.5" /> {t('reset')}
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-[var(--deck-glass-border)] px-3 py-1.5 text-xs font-medium text-[var(--deck-text-hi)] hover:bg-[var(--deck-glass-fill-strong)]"
            >
              {tc('cancel')}
            </button>
            <button
              onClick={() => onSave(isNeutral ? undefined : values)}
              className="rounded-lg bg-[var(--deck-accent)] px-3 py-1.5 text-xs font-medium text-white "
            >
              {tc('save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
