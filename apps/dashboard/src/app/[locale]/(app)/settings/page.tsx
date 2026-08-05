'use client';
import { usePathname, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Moon, Sun, SettingsIcon, Clock, Globe, Timer, ShieldQuestion, CalendarDays, Send, MousePointerClick, RotateCw } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';
import { useTimeFormat } from '@/hooks/useTimeFormat';
import { useConfirmBeforeDelete } from '@/hooks/useConfirmBeforeDelete';
import { useDefaultItemDuration } from '@/hooks/useDefaultItemDuration';
import { useFaithFeatures } from '@/hooks/useFaithFeatures';
import { useRequireSelectToEdit } from '@/hooks/useRequireSelectToEdit';
import { useRotateHandleStyle } from '@/hooks/useRotateHandleStyle';
import { useDateFormat } from '@/hooks/useDateFormat';
import { usePermissions } from '@/hooks/usePermissions';
import { orgApi } from '@/lib/api';
import { Toggle } from '@/components/Toggle';

function SettingsSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="mt-8 first:mt-0">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{description}</p>
      <div>{children}</div>
    </div>
  );
}

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
  const qc = useQueryClient();
  const { theme, toggleTheme } = useTheme();
  const { format, setFormat } = useTimeFormat();
  const { enabled: confirmBeforeDelete, setEnabled: setConfirmBeforeDelete } = useConfirmBeforeDelete();
  const { duration, setDuration } = useDefaultItemDuration();
  const { enabled: faithFeatures, setEnabled: setFaithFeatures } = useFaithFeatures();
  const { enabled: requireSelectToEdit, setEnabled: setRequireSelectToEdit } = useRequireSelectToEdit();
  const { style: rotateHandleStyle, setStyle: setRotateHandleStyle } = useRotateHandleStyle();
  const { format: dateFormat, setFormat: setDateFormat } = useDateFormat();
  const { canManageMembers } = usePermissions();
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const isDark = theme === 'dark';
  const t = useTranslations('settings');

  const { data: orgSettings } = useQuery({ queryKey: ['orgSettings'], queryFn: orgApi.getSettings });
  const autoPublish = orgSettings?.autoPublish ?? false;
  const autoPublishMut = useMutation({
    mutationFn: (value: boolean) => orgApi.updateSettings(value),
    onSuccess: (updated) => qc.setQueryData(['orgSettings'], updated),
  });

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

      <SettingsSection title={t('sectionGeneral')} description={t('sectionGeneralDesc')}>
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
          icon={<ShieldQuestion className="w-5 h-5 text-gray-400 dark:text-gray-500" />}
          title={t('confirmBeforeDelete')}
          description={t('confirmBeforeDeleteDesc')}
          control={<Toggle checked={confirmBeforeDelete} onChange={setConfirmBeforeDelete} />}
        />
      </SettingsSection>

      <SettingsSection title={t('sectionEditor')} description={t('sectionEditorDesc')}>
        <SettingRow
          icon={<MousePointerClick className="w-5 h-5 text-gray-400 dark:text-gray-500" />}
          title={t('requireSelectToEdit')}
          description={t('requireSelectToEditDesc')}
          control={<Toggle checked={requireSelectToEdit} onChange={setRequireSelectToEdit} />}
        />

        <SettingRow
          icon={<RotateCw className="w-5 h-5 text-gray-400 dark:text-gray-500" />}
          title={t('rotateHandleStyle')}
          description={t('rotateHandleStyleDesc')}
          control={
            <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              <button onClick={() => setRotateHandleStyle('corners')}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${rotateHandleStyle === 'corners' ? 'bg-indigo-600 text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
                {t('rotateHandleCorners')}
              </button>
              <button onClick={() => setRotateHandleStyle('single')}
                className={`px-3 py-1.5 text-xs font-medium transition-colors border-s border-gray-200 dark:border-gray-700 ${rotateHandleStyle === 'single' ? 'bg-indigo-600 text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
                {t('rotateHandleSingle')}
              </button>
            </div>
          }
        />
      </SettingsSection>

      <SettingsSection title={t('sectionContent')} description={t('sectionContentDesc')}>
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
          icon={<Moon className="w-5 h-5 text-gray-400 dark:text-gray-500" />}
          title={t('faithFeatures')}
          description={t('faithFeaturesDesc')}
          control={<Toggle checked={faithFeatures} onChange={setFaithFeatures} />}
        />

        <SettingRow
          icon={<Send className="w-5 h-5 text-gray-400 dark:text-gray-500" />}
          title={t('autoPublish')}
          description={t('autoPublishDesc')}
          control={
            <div title={canManageMembers ? undefined : t('autoPublishNoPermission')} className={canManageMembers ? undefined : 'opacity-50 cursor-not-allowed'}>
              <Toggle
                checked={autoPublish}
                onChange={v => { if (canManageMembers) autoPublishMut.mutate(v); }}
              />
            </div>
          }
        />
      </SettingsSection>
    </div>
  );
}
