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
        className="flex max-h-full w-full max-w-3xl flex-col gap-4 overflow-y-auto rounded-xl bg-white p-5 dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex w-full items-center justify-between gap-6">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t('title')}</p>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
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
                      ? 'border-indigo-400 bg-indigo-50 text-indigo-600 dark:border-indigo-500 dark:bg-indigo-950 dark:text-indigo-300'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300 dark:border-gray-700 dark:text-gray-400'
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
                    <label className="text-[10px] text-gray-400 dark:text-gray-500">{t(`fields.${key}`)}</label>
                    <span className="font-mono text-[9px] text-gray-400 dark:text-gray-500">{values[key]}</span>
                  </div>
                  <input
                    type="range"
                    min={min}
                    max={max}
                    value={values[key]}
                    onChange={(e) => set(key, parseInt(e.target.value, 10))}
                    className="w-full accent-indigo-500"
                  />
                </div>
              ))}
            </div>

            <div>
              <label className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-gray-600 dark:text-gray-300">
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
                    className="h-7 w-7 cursor-pointer rounded border border-gray-200 dark:border-gray-700"
                  />
                  <input
                    type="color"
                    value={values.duotone.color2}
                    onChange={(e) => setValues((v) => ({ ...v, preset: 'custom', duotone: { ...v.duotone!, color2: e.target.value } }))}
                    className="h-7 w-7 cursor-pointer rounded border border-gray-200 dark:border-gray-700"
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex w-full items-center justify-between gap-2 pt-1">
          <button
            onClick={() => setValues(NEUTRAL)}
            className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
          >
            <RotateCcw className="h-3.5 w-3.5" /> {t('reset')}
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              {tc('cancel')}
            </button>
            <button
              onClick={() => onSave(isNeutral ? undefined : values)}
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
