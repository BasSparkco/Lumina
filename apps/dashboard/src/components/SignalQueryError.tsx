'use client';
import { useTranslations } from 'next-intl';

/** Shared failure presentation; the caller retains query keys and retry behavior. */
export function SignalQueryError({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations('common');
  return (
    <div role="alert" className="signal-query-error">
      <p>{t('loadFailed')}</p>
      <button type="button" onClick={onRetry}>{t('retryLoad')}</button>
    </div>
  );
}
