'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { CreditCard, Check, AlertTriangle } from 'lucide-react';
import { screensApi } from '@/lib/api';
import { billingApi, PLANS, planLimit, type PlanId } from '@/lib/mocks/billing';
import { useRouteGuard } from '@/hooks/useRouteGuard';
import { PreviewFeatureNotice } from '@/components/PreviewFeatureNotice';

export default function BillingPage() {
  const qc = useQueryClient();
  // Temporarily hidden for the testing phase — restore `useRouteGuard(usePermissions().canManageBilling)` to bring it back.
  const canRender = useRouteGuard(false);
  const t = useTranslations('billing');

  const { data: screens = [] } = useQuery({ queryKey: ['screens'], queryFn: screensApi.list, enabled: canRender });
  const { data: currentPlan = 'STARTER', isLoading } = useQuery({
    queryKey: ['billingPlan'], queryFn: billingApi.getCurrentPlan, enabled: canRender,
  });

  const upgradeMut = useMutation({
    mutationFn: (planId: PlanId) => billingApi.upgrade(planId),
    onSuccess: (planId) => qc.setQueryData(['billingPlan'], planId),
  });

  if (!canRender) return null;

  const limit = planLimit(currentPlan);
  const usagePct = limit ? Math.min(100, (screens.length / limit) * 100) : 0;
  const atLimit = limit !== null && screens.length >= limit;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('title')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('subtitle')}</p>
      </div>

      <PreviewFeatureNotice />

      {!isLoading && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5 mb-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-indigo-600" /> {t('currentPlan', { plan: t(`plans.${currentPlan}`) })}
            </p>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {limit === null ? t('screenUsageUnlimited', { count: screens.length }) : t('screenUsage', { count: screens.length, limit })}
            </span>
          </div>
          {limit !== null && (
            <div className="bg-gray-100 dark:bg-gray-800 rounded h-2 overflow-hidden">
              <div className={`h-full ${atLimit ? 'bg-red-500' : 'bg-indigo-500'}`} style={{ width: `${usagePct}%` }} />
            </div>
          )}
          {atLimit && (
            <p className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400 mt-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {t('limitReachedNote')}
            </p>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PLANS.map(plan => {
          const isCurrent = plan.id === currentPlan;
          return (
            <div key={plan.id}
              className={`border rounded-xl p-5 flex flex-col ${isCurrent ? 'border-indigo-500 ring-1 ring-indigo-500' : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900'}`}>
              <p className="font-semibold text-gray-900 dark:text-gray-100">{t(`plans.${plan.id}`)}</p>
              <p className="mt-2">
                <span className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {plan.priceMonthly === 0 ? t('freePrice') : `$${plan.priceMonthly}`}
                </span>
                {plan.priceMonthly > 0 && <span className="text-sm text-gray-400 dark:text-gray-500">{t('perMonth')}</span>}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 mb-4">
                {plan.screenLimit === null ? t('unlimitedScreens') : t('screenLimitLabel', { limit: plan.screenLimit })}
              </p>
              <div className="mt-auto">
                {isCurrent ? (
                  <span className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-sm font-medium bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-400">
                    <Check className="w-4 h-4" /> {t('currentPlanBadge')}
                  </span>
                ) : (
                  <button onClick={() => upgradeMut.mutate(plan.id)} disabled={upgradeMut.isPending}
                    className="w-full py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
                    {upgradeMut.isPending && upgradeMut.variables === plan.id ? t('updating') : t('choosePlan')}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
