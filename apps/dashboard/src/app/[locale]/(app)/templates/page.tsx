'use client';
import { useTranslations } from 'next-intl';

export default function TemplatesPage() {
  const t = useTranslations('templates');
  return (
    <div className="p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('title')}</h1>
    </div>
  );
}
