'use client';
import { useTranslations } from 'next-intl';
import { TimezoneSelect } from './TimezoneSelect';

export type WidgetKind = 'PRAYER' | 'WEATHER' | 'CURRENCY' | 'TICKER' | 'TIME' | 'DATE' | 'QR';

const PRAYER_METHOD_VALUES = [
  'UmmAlQura',
  'Dubai',
  'Kuwait',
  'Qatar',
  'Egyptian',
  'MuslimWorldLeague',
  'NorthAmerica',
];

interface WidgetConfigFieldsProps {
  widgetType: WidgetKind;
  config: Record<string, unknown>;
  // Discrete changes (selects, checkboxes) — each one is its own undo step.
  onChangeCommitted: (cfg: Record<string, unknown>) => void;
  // Continuous typing (the RSS URL field) — live-updates with no history entry per keystroke;
  // onFocusField/onBlurField below bracket the whole edit into a single undo step instead.
  onChange: (cfg: Record<string, unknown>) => void;
  onFocusField: () => void;
  onBlurField: () => void;
}

// Shared by the layout and theme editors — per-widget-type config fields for a PRAYER/WEATHER/
// CURRENCY/TICKER zone or theme element. Kept as one component so both editors' widget config
// UIs (and the undo bracketing around them) never drift apart again.
export function WidgetConfigFields({
  widgetType,
  config,
  onChange,
  onChangeCommitted,
  onFocusField,
  onBlurField,
}: WidgetConfigFieldsProps) {
  const cfg = config ?? {};
  const t = useTranslations('layouts.widget');
  const ts = useTranslations('screens.prayer.methods');

  switch (widgetType) {
    case 'PRAYER':
      return (
        <div className="grid grid-cols-3 gap-2 rounded bg-amber-50 p-2 text-xs dark:bg-amber-950/40">
          <div>
            <label className="mb-0.5 block text-gray-500">{t('methodOverride')}</label>
            <select
              value={(cfg.method as string) ?? ''}
              onChange={(e) => onChangeCommitted({ ...cfg, method: e.target.value || undefined })}
              className="w-full rounded border border-gray-200 px-1.5 py-1 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            >
              <option value="">{t('inheritFromScreen')}</option>
              {PRAYER_METHOD_VALUES.map((m) => (
                <option key={m} value={m}>
                  {ts(m)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-0.5 block text-gray-500">{t('language')}</label>
            <select
              value={(cfg.lang as string) ?? 'en'}
              onChange={(e) => onChangeCommitted({ ...cfg, lang: e.target.value })}
              className="w-full rounded border border-gray-200 px-1.5 py-1 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            >
              <option value="en">{t('english')}</option>
              <option value="ar">{t('arabicNative')}</option>
            </select>
          </div>
          <label className="flex cursor-pointer items-center gap-1.5 self-end">
            <input
              type="checkbox"
              checked={!!cfg.athanEnabled}
              onChange={(e) => onChangeCommitted({ ...cfg, athanEnabled: e.target.checked })}
            />
            <span className="text-gray-600">{t('athanAudio')}</span>
          </label>
        </div>
      );
    case 'WEATHER':
      return (
        <div className="grid grid-cols-2 gap-2 rounded bg-sky-50 p-2 text-xs dark:bg-sky-950/40">
          <div>
            <label className="mb-0.5 block text-gray-500">{t('language')}</label>
            <select
              value={(cfg.lang as string) ?? 'en'}
              onChange={(e) => onChangeCommitted({ ...cfg, lang: e.target.value })}
              className="w-full rounded border border-gray-200 px-1.5 py-1 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            >
              <option value="en">{t('english')}</option>
              <option value="ar">{t('arabic')}</option>
            </select>
          </div>
          <p className="self-center text-gray-400">{t('locationInherited')}</p>
        </div>
      );
    case 'CURRENCY':
      return (
        <div className="grid grid-cols-2 gap-2 rounded bg-emerald-50 p-2 text-xs dark:bg-emerald-950/40">
          <div>
            <label className="mb-0.5 block text-gray-500">{t('baseCurrency')}</label>
            <select
              value={(cfg.base as string) ?? 'USD'}
              onChange={(e) => onChangeCommitted({ ...cfg, base: e.target.value })}
              className="w-full rounded border border-gray-200 px-1.5 py-1 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            >
              {['USD', 'EUR', 'GBP', 'SAR', 'AED'].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-0.5 block text-gray-500">{t('language')}</label>
            <select
              value={(cfg.lang as string) ?? 'en'}
              onChange={(e) => onChangeCommitted({ ...cfg, lang: e.target.value })}
              className="w-full rounded border border-gray-200 px-1.5 py-1 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            >
              <option value="en">{t('english')}</option>
              <option value="ar">{t('arabic')}</option>
            </select>
          </div>
        </div>
      );
    case 'TICKER': {
      const sourceType = (cfg.sourceType as string) === 'text' ? 'text' : 'rss';
      return (
        <div className="space-y-2 rounded bg-orange-50 p-2 text-xs dark:bg-orange-950/40">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-0.5 block text-gray-500">{t('tickerSource')}</label>
              <select
                value={sourceType}
                onChange={(e) => onChangeCommitted({ ...cfg, sourceType: e.target.value })}
                className="w-full rounded border border-gray-200 px-1.5 py-1 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              >
                <option value="rss">{t('tickerSourceRss')}</option>
                <option value="text">{t('tickerSourceText')}</option>
              </select>
            </div>
            <div>
              <label className="mb-0.5 block text-gray-500">{t('scrollDirection')}</label>
              <select
                value={(cfg.direction as string) ?? 'horizontal'}
                onChange={(e) => onChangeCommitted({ ...cfg, direction: e.target.value })}
                className="w-full rounded border border-gray-200 px-1.5 py-1 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              >
                <option value="horizontal">{t('directionHorizontal')}</option>
                <option value="vertical">{t('directionVertical')}</option>
              </select>
            </div>
          </div>
          {sourceType === 'text' ? (
            <div>
              <label className="mb-0.5 block text-gray-500">{t('tickerText')}</label>
              <textarea
                value={(cfg.staticText as string) ?? ''}
                onChange={(e) => onChange({ ...cfg, staticText: e.target.value })}
                onFocus={onFocusField}
                onBlur={onBlurField}
                rows={3}
                placeholder={t('tickerTextPlaceholder')}
                className="w-full resize-none rounded border border-gray-200 px-2 py-1 focus:ring-1 focus:ring-orange-400 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>
          ) : (
            <div>
              <label className="mb-0.5 block text-gray-500">{t('rssFeedUrl')}</label>
              <input
                type="url"
                value={(cfg.feedUrl as string) ?? ''}
                onChange={(e) => onChange({ ...cfg, feedUrl: e.target.value })}
                onFocus={onFocusField}
                onBlur={onBlurField}
                placeholder="https://feeds.bbcnews.com/world/rss.xml"
                className="w-full rounded border border-gray-200 px-2 py-1 focus:ring-1 focus:ring-orange-400 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>
          )}
        </div>
      );
    }
    case 'TIME':
      return (
        <div className="grid grid-cols-2 gap-2 rounded bg-violet-50 p-2 text-xs dark:bg-violet-950/40">
          <div>
            <label className="mb-0.5 block text-gray-500">{t('clockFormat')}</label>
            <select
              value={(cfg.hour12 as boolean | undefined) === false ? '24' : '12'}
              onChange={(e) => onChangeCommitted({ ...cfg, hour12: e.target.value !== '24' })}
              className="w-full rounded border border-gray-200 px-1.5 py-1 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            >
              <option value="12">{t('clock12h')}</option>
              <option value="24">{t('clock24h')}</option>
            </select>
          </div>
          <label className="flex cursor-pointer items-center gap-1.5 self-end">
            <input
              type="checkbox"
              checked={!!cfg.showSeconds}
              onChange={(e) => onChangeCommitted({ ...cfg, showSeconds: e.target.checked })}
            />
            <span className="text-gray-600">{t('showSeconds')}</span>
          </label>
          <div className="col-span-2">
            <label className="mb-0.5 flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={cfg.timezone != null}
                onChange={(e) =>
                  onChangeCommitted({ ...cfg, timezone: e.target.checked ? 'UTC' : undefined })
                }
              />
              <span className="text-gray-500">{t('timezoneOverride')}</span>
            </label>
            {cfg.timezone != null && (
              <TimezoneSelect
                value={cfg.timezone as string}
                onChange={(tz) => onChangeCommitted({ ...cfg, timezone: tz })}
              />
            )}
          </div>
        </div>
      );
    case 'DATE':
      return (
        <div className="grid grid-cols-2 gap-2 rounded bg-teal-50 p-2 text-xs dark:bg-teal-950/40">
          <div>
            <label className="mb-0.5 block text-gray-500">{t('dateFormat')}</label>
            <select
              value={(cfg.format as string) ?? 'long'}
              onChange={(e) => onChangeCommitted({ ...cfg, format: e.target.value })}
              className="w-full rounded border border-gray-200 px-1.5 py-1 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            >
              <option value="long">{t('dateFormatLong')}</option>
              <option value="short">{t('dateFormatShort')}</option>
            </select>
          </div>
          <div>
            <label className="mb-0.5 block text-gray-500">{t('language')}</label>
            <select
              value={(cfg.lang as string) ?? 'en'}
              onChange={(e) => onChangeCommitted({ ...cfg, lang: e.target.value })}
              className="w-full rounded border border-gray-200 px-1.5 py-1 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            >
              <option value="en">{t('english')}</option>
              <option value="ar">{t('arabic')}</option>
            </select>
          </div>
          <div className="col-span-2">
            <label className="mb-0.5 flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={cfg.timezone != null}
                onChange={(e) =>
                  onChangeCommitted({ ...cfg, timezone: e.target.checked ? 'UTC' : undefined })
                }
              />
              <span className="text-gray-500">{t('timezoneOverride')}</span>
            </label>
            {cfg.timezone != null && (
              <TimezoneSelect
                value={cfg.timezone as string}
                onChange={(tz) => onChangeCommitted({ ...cfg, timezone: tz })}
              />
            )}
          </div>
        </div>
      );
    case 'QR':
      return (
        <div className="space-y-2 rounded bg-rose-50 p-2 text-xs dark:bg-rose-950/40">
          <div>
            <label className="mb-0.5 block text-gray-500">{t('qrValue')}</label>
            <input
              value={(cfg.value as string) ?? ''}
              onChange={(e) => onChange({ ...cfg, value: e.target.value })}
              onFocus={onFocusField}
              onBlur={onBlurField}
              placeholder={t('qrValuePlaceholder')}
              className="w-full rounded border border-gray-200 px-2 py-1 focus:ring-1 focus:ring-rose-400 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="mb-0.5 block text-gray-500">{t('qrForeground')}</label>
              <input
                type="color"
                value={(cfg.color as string) ?? '#000000'}
                onChange={(e) => onChangeCommitted({ ...cfg, color: e.target.value })}
                className="h-7 w-full cursor-pointer rounded border border-gray-200 p-0.5 dark:border-gray-700"
              />
            </div>
            <div>
              <label className="mb-0.5 block text-gray-500">{t('qrBackground')}</label>
              <input
                type="color"
                value={(cfg.background as string) ?? '#ffffff'}
                onChange={(e) => onChangeCommitted({ ...cfg, background: e.target.value })}
                className="h-7 w-full cursor-pointer rounded border border-gray-200 p-0.5 dark:border-gray-700"
              />
            </div>
            <div>
              <label className="mb-0.5 block text-gray-500">{t('qrSize')}</label>
              <input
                type="number"
                min={20}
                max={100}
                value={(cfg.sizePercent as number) ?? 90}
                onChange={(e) =>
                  onChangeCommitted({ ...cfg, sizePercent: parseInt(e.target.value, 10) || 90 })
                }
                className="w-full rounded border border-gray-200 px-1.5 py-1 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>
          </div>
        </div>
      );
    default:
      return null;
  }
}
