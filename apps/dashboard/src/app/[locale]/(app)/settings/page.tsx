'use client';
import { usePathname, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Moon, Sun, SettingsIcon, Clock, Globe, Timer, ShieldQuestion, CalendarDays } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';
import { useTimeFormat } from '@/hooks/useTimeFormat';
import { useConfirmBeforeDelete } from '@/hooks/useConfirmBeforeDelete';
import { useDefaultItemDuration } from '@/hooks/useDefaultItemDuration';
import { useFaithFeatures } from '@/hooks/useFaithFeatures';
import { useDateFormat } from '@/hooks/useDateFormat';
import { Toggle } from '@/components/Toggle';

function SettingRow({ icon, title, description, control }: { icon: React.ReactNode; title: string; description: string; control: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5 mt-4 first:mt-0">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          {icon}
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{title}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">{description}</p>
          </div>
        </div>
        <div className="shrink-0">{control}</div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { theme, toggleTheme } = useTheme();
  const { format, setFormat } = useTimeFormat();
  const { enabled: confirmBeforeDelete, setEnabled: setConfirmBeforeDelete } = useConfirmBeforeDelete();
  const { duration, setDuration } = useDefaultItemDuration();
  const { enabled: faithFeatures, setEnabled: setFaithFeatures } = useFaithFeatures();
  const { format: dateFormat, setFormat: setDateFormat } = useDateFormat();
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const isDark = theme === 'dark';
  const t = useTranslations('settings');

  function switchLocale(next: string) {
    router.push(pathname.replace(`/${locale}`, `/${next}`));
  }

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <SettingsIcon className="w-5 h-5 text-gray-400 dark:text-gray-500" /> {t('title')}
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('subtitle')}</p>
      </div>

      <SettingRow
        icon={isDark ? <Moon className="w-5 h-5 text-indigo-400" /> : <Sun className="w-5 h-5 text-amber-500" />}
        title={t('darkMode')}
        description={t('darkModeDesc')}
        control={<Toggle checked={isDark} onChange={toggleTheme} />}
      />

      <SettingRow
        icon={<Clock className="w-5 h-5 text-gray-400 dark:text-gray-500" />}
        title={t('timeFormat')}
        description={t('timeFormatDesc')}
        control={
          <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <button onClick={() => setFormat('24h')}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${format === '24h' ? 'bg-indigo-600 text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
              {t('24h')}
            </button>
            <button onClick={() => setFormat('12h')}
              className={`px-3 py-1.5 text-xs font-medium transition-colors border-s border-gray-200 dark:border-gray-700 ${format === '12h' ? 'bg-indigo-600 text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
              {t('ampm')}
            </button>
          </div>
        }
      />

      <SettingRow
        icon={<Globe className="w-5 h-5 text-gray-400 dark:text-gray-500" />}
        title={t('language')}
        description={t('languageDesc')}
        control={
          <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <button onClick={() => switchLocale('en')}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${locale === 'en' ? 'bg-indigo-600 text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
              {t('english')}
            </button>
            <button onClick={() => switchLocale('ar')}
              className={`px-3 py-1.5 text-xs font-medium transition-colors border-s border-gray-200 dark:border-gray-700 ${locale === 'ar' ? 'bg-indigo-600 text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
              {t('arabic')}
            </button>
          </div>
        }
      />

      <SettingRow
        icon={<CalendarDays className="w-5 h-5 text-gray-400 dark:text-gray-500" />}
        title={t('dateFormat')}
        description={t('dateFormatDesc')}
        control={
          <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <button onClick={() => setDateFormat('DD/MM/YYYY')}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${dateFormat === 'DD/MM/YYYY' ? 'bg-indigo-600 text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
              DD/MM/YYYY
            </button>
            <button onClick={() => setDateFormat('MM/DD/YYYY')}
              className={`px-3 py-1.5 text-xs font-medium transition-colors border-s border-gray-200 dark:border-gray-700 ${dateFormat === 'MM/DD/YYYY' ? 'bg-indigo-600 text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
              MM/DD/YYYY
            </button>
          </div>
        }
      />

      <SettingRow
        icon={<Moon className="w-5 h-5 text-gray-400 dark:text-gray-500" />}
        title={t('faithFeatures')}
        description={t('faithFeaturesDesc')}
        control={<Toggle checked={faithFeatures} onChange={setFaithFeatures} />}
      />

      <SettingRow
        icon={<Timer className="w-5 h-5 text-gray-400 dark:text-gray-500" />}
        title={t('defaultDuration')}
        description={t('defaultDurationDesc')}
        control={
          <div className="flex items-center gap-1.5">
            <input type="number" min={1} max={3600} value={duration}
              onChange={e => setDuration(Math.max(1, Number(e.target.value) || 1))}
              className="w-16 border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1.5 text-xs text-center focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <span className="text-xs text-gray-400 dark:text-gray-500">{t('sec')}</span>
          </div>
        }
      />

      <SettingRow
        icon={<ShieldQuestion className="w-5 h-5 text-gray-400 dark:text-gray-500" />}
        title={t('confirmBeforeDelete')}
        description={t('confirmBeforeDeleteDesc')}
        control={<Toggle checked={confirmBeforeDelete} onChange={setConfirmBeforeDelete} />}
      />
    </div>
  );
}
