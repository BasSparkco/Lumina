'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X, Check, Link2, ChevronRight } from 'lucide-react';
import { usePermissions } from '@/hooks/usePermissions';
import { useRouteGuard } from '@/hooks/useRouteGuard';
import { platformTenantsApi, type CreateTenantInput, type TenantSummary } from '@/lib/api';
import { ModuleAssignmentsEditor, defaultModuleAssignments, findDependencyErrors, type ModuleAssignmentDraft } from '@/components/ModuleAssignmentsEditor';
import type { OrganizationStatus } from '@lumina/types';

const inputClass =
  'w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-indigo-400 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

const STATUS_STYLES: Record<OrganizationStatus, string> = {
  ACTIVE: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400',
  SUSPENDED: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
};

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-xl bg-white p-5 shadow-xl dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function CreateTenantModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations('adminTenants');
  const tc = useTranslations('common');
  const locale = useLocale();
  const qc = useQueryClient();

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [ownerEmail, setOwnerEmail] = useState('');
  const [modules, setModules] = useState<ModuleAssignmentDraft[]>(defaultModuleAssignments());
  const [result, setResult] = useState<{ email: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const dependencyErrors = findDependencyErrors(modules);

  const createMut = useMutation({
    mutationFn: (input: CreateTenantInput) => platformTenantsApi.create(input),
    onSuccess: (tenant) => {
      void qc.invalidateQueries({ queryKey: ['admin-tenants'] });
      setResult({ email: tenant.ownerInvite.email, token: tenant.ownerInvite.token });
    },
  });

  function submit() {
    if (dependencyErrors.length > 0) return;
    createMut.mutate({
      name: name.trim(),
      slug: slug.trim(),
      ownerEmail: ownerEmail.trim(),
      modules: modules
        .filter((m) => m.status !== 'DISABLED')
        .map((m) => ({ key: m.key, status: m.status, expiresAt: m.expiresAt ? new Date(m.expiresAt).toISOString() : undefined })),
    });
  }

  function copyInviteLink() {
    if (!result) return;
    const url = `${window.location.origin}/${locale}/accept-invite?token=${result.token}`;
    void navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (result) {
    return (
      <Modal title={t('createSuccessTitle')} onClose={onClose}>
        <p className="text-sm text-gray-600 dark:text-gray-300">{t('createSuccessBody', { email: result.email })}</p>
        <button
          onClick={copyInviteLink}
          className="flex items-center justify-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          {copied ? <Check className="h-4 w-4 text-green-600" /> : <Link2 className="h-4 w-4" />}
          {copied ? t('copied') : t('copyInviteLink')}
        </button>
        <div className="flex justify-end">
          <button onClick={onClose} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700">
            {tc('close')}
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={t('createTenant')} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
          {t('tenantName')}
          <input
            className={`${inputClass} mt-1`}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugTouched) setSlug(slugify(e.target.value));
            }}
            required
          />
        </label>
        <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
          {t('slug')}
          <input
            className={`${inputClass} mt-1`}
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value);
              setSlugTouched(true);
            }}
            required
          />
        </label>
        <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
          {t('ownerEmail')}
          <input
            type="email"
            className={`${inputClass} mt-1`}
            value={ownerEmail}
            onChange={(e) => setOwnerEmail(e.target.value)}
            required
          />
        </label>
        <div>
          <p className="mb-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">{t('modules')}</p>
          <ModuleAssignmentsEditor value={modules} onChange={setModules} />
        </div>
        {createMut.error && <p className="text-xs text-red-600 dark:text-red-400">{(createMut.error as Error).message}</p>}
        <div className="mt-1 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
            {tc('cancel')}
          </button>
          <button
            onClick={submit}
            disabled={createMut.isPending || !name.trim() || !slug.trim() || !ownerEmail.trim() || dependencyErrors.length > 0}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {createMut.isPending ? tc('loading') : tc('create')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ModuleSummary({ modules }: { modules: TenantSummary['modules'] }) {
  const t = useTranslations('adminTenants');
  const active = modules.filter((m) => m.status !== 'DISABLED');
  if (active.length === 0) return <span className="text-xs text-gray-400 dark:text-gray-600">{t('noModules')}</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {active.map((m) => (
        <span key={m.key} className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600 dark:bg-gray-800 dark:text-gray-300">
          {t(`moduleNames.${m.key}`)}{m.status === 'TRIAL' ? ` (${t('status.TRIAL')})` : ''}
        </span>
      ))}
    </div>
  );
}

export default function AdminTenantsPage() {
  const locale = useLocale();
  const t = useTranslations('adminTenants');
  const tc = useTranslations('common');
  const { isSuperAdmin } = usePermissions();
  const canRender = useRouteGuard(isSuperAdmin);
  const [showCreate, setShowCreate] = useState(false);

  const { data: tenants = [], isLoading } = useQuery({ queryKey: ['admin-tenants'], queryFn: platformTenantsApi.list, enabled: canRender });

  if (!canRender) return null;

  return (
    <div className="mx-auto max-w-5xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('title')}</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t('subtitle')}</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          <Plus className="h-4 w-4" /> {t('createTenant')}
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-900 dark:text-gray-400">
            <tr>
              <th className="px-4 py-2">{tc('name')}</th>
              <th className="px-4 py-2">{t('slug')}</th>
              <th className="px-4 py-2">{t('statusLabel')}</th>
              <th className="px-4 py-2">{t('modules')}</th>
              <th className="px-4 py-2">{t('created')}</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {isLoading && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400 dark:text-gray-600">{tc('loading')}</td></tr>
            )}
            {!isLoading && tenants.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400 dark:text-gray-600">{t('empty')}</td></tr>
            )}
            {tenants.map((tenant) => (
              <tr key={tenant.id} className="text-gray-700 dark:text-gray-200">
                <td className="px-4 py-2 font-medium">{tenant.name}</td>
                <td className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400">{tenant.slug}</td>
                <td className="px-4 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[tenant.status]}`}>{t(`tenantStatus.${tenant.status}`)}</span>
                </td>
                <td className="px-4 py-2"><ModuleSummary modules={tenant.modules} /></td>
                <td className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400">{new Date(tenant.createdAt).toLocaleDateString()}</td>
                <td className="px-4 py-2 text-end">
                  <Link
                    href={`/${locale}/admin/tenants/${tenant.id}`}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950/30"
                  >
                    {t('manage')} <ChevronRight className="h-3 w-3" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && <CreateTenantModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}
