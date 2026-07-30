'use client';
import { useTranslations } from 'next-intl';
import { TimezoneSelect } from './TimezoneSelect';

export type WidgetKind = 'PRAYER' | 'WEATHER' | 'CURRENCY' | 'TICKER' | 'TIME' | 'DATE';

const PRAYER_METHOD_VALUES = ['UmmAlQura', 'Dubai', 'Kuwait', 'Qatar', 'Egyptian', 'MuslimWorldLeague', 'NorthAmerica'];

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
export function WidgetConfigFields({ widgetType, config, onChange, onChangeCommitted, onFocusField, onBlurField }: WidgetConfigFieldsProps) {
  const cfg = config ?? {};
  const t = useTranslations('layouts.widget');
  const ts = useTranslations('screens.prayer.methods');

  switch (widgetType) {
    case 'PRAYER':
      return (
        <div className="grid grid-cols-3 gap-2 bg-amber-50 dark:bg-amber-950/40 rounded p-2 text-xs">
          <div>
            <label className="text-gray-500 block mb-0.5">{t('methodOverride')}</label>
            <select value={(cfg.method as string) ?? ''} onChange={e => onChangeCommitted({ ...cfg, method: e.target.value || undefined })}
              className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-1.5 py-1 focus:outline-none">
              <option value="">{t('inheritFromScreen')}</option>
              {PRAYER_METHOD_VALUES.map(m => <option key={m} value={m}>{ts(m)}</option>)}
            </select>
          </div>
          <div>
            <label className="text-gray-500 block mb-0.5">{t('language')}</label>
            <select value={(cfg.lang as string) ?? 'en'} onChange={e => onChangeCommitted({ ...cfg, lang: e.target.value })}
              className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-1.5 py-1 focus:outline-none">
              <option value="en">{t('english')}</option>
              <option value="ar">{t('arabicNative')}</option>
            </select>
          </div>
          <label className="flex items-center gap-1.5 cursor-pointer self-end">
            <input type="checkbox" checked={!!(cfg.athanEnabled)} onChange={e => onChangeCommitted({ ...cfg, athanEnabled: e.target.checked })} />
            <span className="text-gray-600">{t('athanAudio')}</span>
          </label>
        </div>
      );
    case 'WEATHER':
      return (
        <div className="grid grid-cols-2 gap-2 bg-sky-50 dark:bg-sky-950/40 rounded p-2 text-xs">
          <div>
            <label className="text-gray-500 block mb-0.5">{t('language')}</label>
            <select value={(cfg.lang as string) ?? 'en'} onChange={e => onChangeCommitted({ ...cfg, lang: e.target.value })}
              className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-1.5 py-1 focus:outline-none">
              <option value="en">{t('english')}</option>
              <option value="ar">{t('arabic')}</option>
            </select>
          </div>
          <p className="text-gray-400 self-center">{t('locationInherited')}</p>
        </div>
      );
    case 'CURRENCY':
      return (
        <div className="grid grid-cols-2 gap-2 bg-emerald-50 dark:bg-emerald-950/40 rounded p-2 text-xs">
          <div>
            <label className="text-gray-500 block mb-0.5">{t('baseCurrency')}</label>
            <select value={(cfg.base as string) ?? 'USD'} onChange={e => onChangeCommitted({ ...cfg, base: e.target.value })}
              className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-1.5 py-1 focus:outline-none">
              {['USD', 'EUR', 'GBP', 'SAR', 'AED'].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="text-gray-500 block mb-0.5">{t('language')}</label>
            <select value={(cfg.lang as string) ?? 'en'} onChange={e => onChangeCommitted({ ...cfg, lang: e.target.value })}
              className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-1.5 py-1 focus:outline-none">
              <option value="en">{t('english')}</option>
              <option value="ar">{t('arabic')}</option>
            </select>
          </div>
        </div>
      );
    case 'TICKER': {
      const sourceType = (cfg.sourceType as string) === 'text' ? 'text' : 'rss';
      return (
        <div className="bg-orange-50 dark:bg-orange-950/40 rounded p-2 text-xs space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-gray-500 block mb-0.5">{t('tickerSource')}</label>
              <select value={sourceType} onChange={e => onChangeCommitted({ ...cfg, sourceType: e.target.value })}
                className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-1.5 py-1 focus:outline-none">
                <option value="rss">{t('tickerSourceRss')}</option>
                <option value="text">{t('tickerSourceText')}</option>
              </select>
            </div>
            <div>
              <label className="text-gray-500 block mb-0.5">{t('scrollDirection')}</label>
              <select value={(cfg.direction as string) ?? 'horizontal'} onChange={e => onChangeCommitted({ ...cfg, direction: e.target.value })}
                className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-1.5 py-1 focus:outline-none">
                <option value="horizontal">{t('directionHorizontal')}</option>
                <option value="vertical">{t('directionVertical')}</option>
              </select>
            </div>
          </div>
          {sourceType === 'text' ? (
            <div>
              <label className="text-gray-500 block mb-0.5">{t('tickerText')}</label>
              <textarea value={(cfg.staticText as string) ?? ''} onChange={e => onChange({ ...cfg, staticText: e.target.value })}
                onFocus={onFocusField} onBlur={onBlurField} rows={3}
                placeholder={t('tickerTextPlaceholder')}
                className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-orange-400 resize-none" />
            </div>
          ) : (
            <div>
              <label className="text-gray-500 block mb-0.5">{t('rssFeedUrl')}</label>
              <input type="url" value={(cfg.feedUrl as string) ?? ''} onChange={e => onChange({ ...cfg, feedUrl: e.target.value })}
                onFocus={onFocusField} onBlur={onBlurField}
                placeholder="https://feeds.bbcnews.com/world/rss.xml"
                className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-orange-400" />
            </div>
          )}
        </div>
      );
    }
    case 'TIME':
      return (
        <div className="grid grid-cols-2 gap-2 bg-violet-50 dark:bg-violet-950/40 rounded p-2 text-xs">
          <div>
            <label className="text-gray-500 block mb-0.5">{t('clockFormat')}</label>
            <select value={(cfg.hour12 as boolean | undefined) === false ? '24' : '12'}
              onChange={e => onChangeCommitted({ ...cfg, hour12: e.target.value !== '24' })}
              className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-1.5 py-1 focus:outline-none">
              <option value="12">{t('clock12h')}</option>
              <option value="24">{t('clock24h')}</option>
            </select>
          </div>
          <label className="flex items-center gap-1.5 cursor-pointer self-end">
            <input type="checkbox" checked={!!(cfg.showSeconds)} onChange={e => onChangeCommitted({ ...cfg, showSeconds: e.target.checked })} />
            <span className="text-gray-600">{t('showSeconds')}</span>
          </label>
          <div className="col-span-2">
            <label className="flex items-center gap-1.5 cursor-pointer mb-0.5">
              <input type="checkbox" checked={cfg.timezone != null}
                onChange={e => onChangeCommitted({ ...cfg, timezone: e.target.checked ? 'UTC' : undefined })} />
              <span className="text-gray-500">{t('timezoneOverride')}</span>
            </label>
            {cfg.timezone != null && (
              <TimezoneSelect value={cfg.timezone as string} onChange={tz => onChangeCommitted({ ...cfg, timezone: tz })} />
            )}
          </div>
        </div>
      );
    case 'DATE':
      return (
        <div className="grid grid-cols-2 gap-2 bg-teal-50 dark:bg-teal-950/40 rounded p-2 text-xs">
          <div>
            <label className="text-gray-500 block mb-0.5">{t('dateFormat')}</label>
            <select value={(cfg.format as string) ?? 'long'}
              onChange={e => onChangeCommitted({ ...cfg, format: e.target.value })}
              className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-1.5 py-1 focus:outline-none">
              <option value="long">{t('dateFormatLong')}</option>
              <option value="short">{t('dateFormatShort')}</option>
            </select>
          </div>
          <div>
            <label className="text-gray-500 block mb-0.5">{t('language')}</label>
            <select value={(cfg.lang as string) ?? 'en'} onChange={e => onChangeCommitted({ ...cfg, lang: e.target.value })}
              className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-1.5 py-1 focus:outline-none">
              <option value="en">{t('english')}</option>
              <option value="ar">{t('arabic')}</option>
            </select>
          </div>
          <div className="col-span-2">
            <label className="flex items-center gap-1.5 cursor-pointer mb-0.5">
              <input type="checkbox" checked={cfg.timezone != null}
                onChange={e => onChangeCommitted({ ...cfg, timezone: e.target.checked ? 'UTC' : undefined })} />
              <span className="text-gray-500">{t('timezoneOverride')}</span>
            </label>
            {cfg.timezone != null && (
              <TimezoneSelect value={cfg.timezone as string} onChange={tz => onChangeCommitted({ ...cfg, timezone: tz })} />
            )}
          </div>
        </div>
      );
    default:
      return null;
  }
}
