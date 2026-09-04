'use client';
import { use, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Link2, X } from 'lucide-react';
import { usePermissions } from '@/hooks/usePermissions';
import { useRouteGuard } from '@/hooks/useRouteGuard';
import { platformTenantsApi } from '@/lib/api';
import { ModuleAssignmentsEditor, defaultModuleAssignments, findDependencyErrors, type ModuleAssignmentDraft } from '@/components/ModuleAssignmentsEditor';
import type { OrganizationStatus } from '@lumina/types';

const inputClass =
  'w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-indigo-400 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

const STATUS_STYLES: Record<OrganizationStatus, string> = {
  ACTIVE: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400',
  SUSPENDED: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
};

export default function AdminTenantDetailPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = use(params);
  const locale = useLocale();
  const t = useTranslations('adminTenants');
  const tc = useTranslations('common');
  const qc = useQueryClient();
  const { isSuperAdmin } = usePermissions();
  const canRender = useRouteGuard(isSuperAdmin);

  const { data: tenant, isLoading } = useQuery({
    queryKey: ['admin-tenants', tenantId],
    queryFn: () => platformTenantsApi.detail(tenantId),
    enabled: canRender,
  });

  const [modules, setModules] = useState<ModuleAssignmentDraft[] | null>(null);
  const draft = modules ?? (tenant ? defaultModuleAssignments(tenant.capabilities.modules) : []);
  const dependencyErrors = findDependencyErrors(draft);

  const [ownerEmail, setOwnerEmail] = useState('');
  const [inviteResult, setInviteResult] = useState<{ token: string } | null>(null);
  const [copied, setCopied] = useState(false);

  function invalidateAfterChange() {
    void qc.invalidateQueries({ queryKey: ['admin-tenants', tenantId] });
    void qc.invalidateQueries({ queryKey: ['admin-tenants'] });
    // Cheap safety net: harmless if the Super Admin's own session isn't this tenant, but keeps
    // a same-session view of this tenant's own capabilities current if it is — see
    // docs/adr/platform-modules-and-entitlements.md §7.1.
    void qc.invalidateQueries({ queryKey: ['org', 'capabilities'] });
  }

  const statusMut = useMutation({
    mutationFn: (status: OrganizationStatus) => platformTenantsApi.updateStatus(tenantId, status),
    onSuccess: invalidateAfterChange,
  });

  const modulesMut = useMutation({
    mutationFn: (assignments: ModuleAssignmentDraft[]) =>
      platformTenantsApi.setModules(
        tenantId,
        assignments.map((m) => ({ key: m.key, status: m.status, expiresAt: m.expiresAt ? new Date(m.expiresAt).toISOString() : undefined })),
      ),
    onSuccess: () => {
      setModules(null);
      invalidateAfterChange();
    },
  });

  const inviteMut = useMutation({
    mutationFn: (email: string) => platformTenantsApi.reissueOwnerInvite(tenantId, email),
    onSuccess: (invite) => setInviteResult({ token: invite.token }),
  });

  function toggleStatus() {
    if (!tenant) return;
    const next: OrganizationStatus = tenant.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    const message = next === 'SUSPENDED' ? t('suspendConfirm', { name: tenant.name }) : t('activateConfirm', { name: tenant.name });
    if (window.confirm(message)) statusMut.mutate(next);
  }

  function copyInviteLink() {
    if (!inviteResult) return;
    const url = `${window.location.origin}/${locale}/accept-invite?token=${inviteResult.token}`;
    void navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!canRender) return null;

  return (
    <div className="mx-auto max-w-3xl p-8">
      <Link href={`/${locale}/admin/tenants`} className="mb-4 inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
        <ArrowLeft className="h-3.5 w-3.5" /> {t('backToTenants')}
      </Link>

      {isLoading && <p className="text-sm text-gray-400 dark:text-gray-600">{tc('loading')}</p>}

      {tenant && (
        <>
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{tenant.name}</h1>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{tenant.slug}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[tenant.status]}`}>{t(`tenantStatus.${tenant.status}`)}</span>
              <button
                onClick={toggleStatus}
                disabled={statusMut.isPending}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
                  tenant.status === 'ACTIVE'
                    ? 'border border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/30'
                    : 'bg-indigo-600 text-white hover:bg-indigo-700'
                }`}
              >
                {tenant.status === 'ACTIVE' ? t('suspendTenant') : t('activateTenant')}
              </button>
            </div>
          </div>

          <section className="mb-8 rounded-xl border border-gray-200 p-4 dark:border-gray-800">
            <h2 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">{t('modules')}</h2>
            <ModuleAssignmentsEditor value={draft} onChange={setModules} />
            {modulesMut.error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{(modulesMut.error as Error).message}</p>}
            <div className="mt-3 flex justify-end gap-2">
              {modules && (
                <button onClick={() => setModules(null)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
                  {tc('cancel')}
                </button>
              )}
              <button
                onClick={() => modulesMut.mutate(draft)}
                disabled={!modules || modulesMut.isPending || dependencyErrors.length > 0}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {modulesMut.isPending ? tc('loading') : t('saveModules')}
              </button>
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
            <h2 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">{t('ownerInvite')}</h2>
            <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">{t('ownerInviteHint')}</p>
            {inviteResult ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={copyInviteLink}
                  className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Link2 className="h-3.5 w-3.5" />}
                  {copied ? t('copied') : t('copyInviteLink')}
                </button>
                <button onClick={() => setInviteResult(null)} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  type="email"
                  className={inputClass}
                  placeholder={t('ownerEmail')}
                  value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)}
                />
                <button
                  onClick={() => inviteMut.mutate(ownerEmail.trim())}
                  disabled={!ownerEmail.trim() || inviteMut.isPending}
                  className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {inviteMut.isPending ? tc('loading') : t('sendOwnerInvite')}
                </button>
              </div>
            )}
            {inviteMut.error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{(inviteMut.error as Error).message}</p>}
          </section>
        </>
      )}
    </div>
  );
}
