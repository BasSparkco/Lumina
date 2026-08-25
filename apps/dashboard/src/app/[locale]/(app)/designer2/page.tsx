'use client';
import { useTranslations } from 'next-intl';
import { PenTool } from 'lucide-react';

export default function Designer2Page() {
  const t = useTranslations('nav');

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('designer2')}</h1>
      </div>
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-gray-400 dark:text-gray-600 border border-dashed border-gray-200 dark:border-gray-800 rounded-xl">
        <PenTool className="w-8 h-8" />
        <p className="text-sm">Nothing here yet.</p>
      </div>
    </div>
  );
}
