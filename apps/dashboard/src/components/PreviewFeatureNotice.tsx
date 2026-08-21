'use client';
import { Info } from 'lucide-react';
import { useTranslations } from 'next-intl';

// Shown at the top of every section still backed by lib/mocks/* (Members, Billing, Audit Log,
// Reports, Approvals) instead of a real API — those pages work, but only ever persist to the
// current browser's localStorage, so nothing here syncs across teammates or devices. This makes
// that limitation visible in the product itself rather than something a customer discovers the
// hard way (e.g. inviting a teammate who then sees no invite waiting for them).
export function PreviewFeatureNotice() {
  const t = useTranslations('common');
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/40 px-3.5 py-2.5 mb-6">
      <Info className="w-4 h-4 text-blue-500 dark:text-blue-400 shrink-0 mt-0.5" />
      <div className="min-w-0">
        <p className="text-sm font-medium text-blue-900 dark:text-blue-200">{t('previewFeatureTitle')}</p>
        <p className="text-xs text-blue-700 dark:text-blue-300 mt-0.5">{t('previewFeatureBody')}</p>
      </div>
    </div>
  );
}
