'use client';
import { useTranslations } from 'next-intl';
import { MODULE_KEYS, MODULE_DEPENDENCIES, TENANT_MODULE_STATUSES, type ModuleKey, type TenantModuleStatus } from '@lumina/types';

export interface ModuleAssignmentDraft {
  key: ModuleKey;
  status: TenantModuleStatus;
  expiresAt: string; // yyyy-mm-dd from <input type="date">, '' = no expiry
}

export function defaultModuleAssignments(
  existing?: { key: ModuleKey; status: TenantModuleStatus; expiresAt: string | null }[],
): ModuleAssignmentDraft[] {
  return MODULE_KEYS.map((key) => {
    const current = existing?.find((m) => m.key === key);
    return {
      key,
      status: current?.status ?? 'DISABLED',
      expiresAt: current?.expiresAt ? current.expiresAt.slice(0, 10) : '',
    };
  });
}

// Pure — mirrors EntitlementsService.validateDependencies() closely enough to catch the same
// mistake before it round-trips to the API, but this is UI convenience only; the server always
// re-validates for real (see docs/adr/platform-modules-and-entitlements.md).
export function findDependencyErrors(drafts: ModuleAssignmentDraft[]): ModuleKey[] {
  const byKey = new Map(drafts.map((d) => [d.key, d]));
  const violations: ModuleKey[] = [];
  for (const draft of drafts) {
    if (draft.status === 'DISABLED') continue;
    const dependency = MODULE_DEPENDENCIES[draft.key];
    if (!dependency) continue;
    const dependencyDraft = byKey.get(dependency);
    if (!dependencyDraft || dependencyDraft.status === 'DISABLED') violations.push(draft.key);
  }
  return violations;
}

const selectClass =
  'rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-900 focus:border-indigo-400 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const dateInputClass =
  'rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-900 focus:border-indigo-400 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

export function ModuleAssignmentsEditor({
  value,
  onChange,
}: {
  value: ModuleAssignmentDraft[];
  onChange: (next: ModuleAssignmentDraft[]) => void;
}) {
  const t = useTranslations('adminTenants');
  const violations = new Set(findDependencyErrors(value));

  function update(key: ModuleKey, patch: Partial<ModuleAssignmentDraft>) {
    onChange(value.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  }

  return (
    <div className="space-y-2">
      {value.map((draft) => {
        const dependency = MODULE_DEPENDENCIES[draft.key];
        const violated = violations.has(draft.key);
        return (
          <div key={draft.key} className="rounded-lg border border-gray-200 p-2.5 dark:border-gray-700">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{t(`moduleNames.${draft.key}`)}</span>
              <div className="flex items-center gap-2">
                {draft.status !== 'DISABLED' && (
                  <input
                    type="date"
                    className={dateInputClass}
                    value={draft.expiresAt}
                    onChange={(e) => update(draft.key, { expiresAt: e.target.value })}
                    title={t('expiryOptional')}
                  />
                )}
                <select
                  className={selectClass}
                  value={draft.status}
                  onChange={(e) => update(draft.key, { status: e.target.value as TenantModuleStatus })}
                >
                  {TENANT_MODULE_STATUSES.map((s) => (
                    <option key={s} value={s}>{t(`status.${s}`)}</option>
                  ))}
                </select>
              </div>
            </div>
            {dependency && (
              <p className={`mt-1 text-[11px] ${violated ? 'text-red-600 dark:text-red-400' : 'text-gray-400 dark:text-gray-500'}`}>
                {violated ? t('dependencyError', { module: t(`moduleNames.${draft.key}`), dependency: t(`moduleNames.${dependency}`) }) : t('dependencyNote', { dependency: t(`moduleNames.${dependency}`) })}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
