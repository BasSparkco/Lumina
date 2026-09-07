'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X, Check, Link2, ChevronRight, AlertTriangle, Search } from 'lucide-react';
import { usePermissions } from '@/hooks/usePermissions';
import { useRouteGuard } from '@/hooks/useRouteGuard';
import { platformTenantsApi, type CreateTenantInput, type TenantSummary, type TenantAlert, type TenantListParams } from '@/lib/api';
import { ModuleAssignmentsEditor, defaultModuleAssignments, findDependencyErrors, type ModuleAssignmentDraft } from '@/components/ModuleAssignmentsEditor';
import { formatBytes } from '@/lib/formatBytes';
import { MODULE_KEYS, type ModuleKey } from '@lumina/types';
import type { OrganizationStatus } from '@lumina/types';

const inputClass =
  'w-full rounded-lg border border-[var(--deck-glass-border)] bg-[var(--deck-glass-fill-strong)] px-3 py-1.5 text-sm text-[var(--deck-text-hi)] focus:border-[var(--deck-accent)] focus:outline-none';

const STATUS_STYLES: Record<OrganizationStatus, string> = {
  ACTIVE: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400',
  SUSPENDED: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
};

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6" onClick={onClose}>
      <div
        className="glass-popup flex max-h-[85vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--deck-text-hi)]">{title}</h2>
          <button onClick={onClose} className="text-[var(--deck-text-low)] hover:text-[var(--deck-text-hi)]">
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
        <p className="text-sm text-[var(--deck-text-mid)]">{t('createSuccessBody', { email: result.email })}</p>
        <button
          onClick={copyInviteLink}
          className="flex items-center justify-center gap-2 rounded-lg border border-[var(--deck-glass-border)] px-3 py-2 text-sm font-medium text-[var(--deck-text-hi)] hover:bg-[var(--deck-glass-fill-strong)]"
        >
          {copied ? <Check className="h-4 w-4 text-green-600" /> : <Link2 className="h-4 w-4" />}
          {copied ? t('copied') : t('copyInviteLink')}
        </button>
        <div className="flex justify-end">
          <button onClick={onClose} className="rounded-lg bg-[var(--deck-accent)] px-3 py-1.5 text-xs font-medium text-white ">
            {tc('close')}
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={t('createTenant')} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <label className="text-xs font-medium text-[var(--deck-text-mid)]">
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
        <label className="text-xs font-medium text-[var(--deck-text-mid)]">
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
        <label className="text-xs font-medium text-[var(--deck-text-mid)]">
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
          <p className="mb-1.5 text-xs font-medium text-[var(--deck-text-mid)]">{t('modules')}</p>
          <ModuleAssignmentsEditor value={modules} onChange={setModules} />
        </div>
        {createMut.error && <p className="text-xs text-red-600 dark:text-red-400">{(createMut.error as Error).message}</p>}
        <div className="mt-1 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-[var(--deck-glass-border)] px-3 py-1.5 text-xs font-medium text-[var(--deck-text-hi)] hover:bg-[var(--deck-glass-fill-strong)]">
            {tc('cancel')}
          </button>
          <button
            onClick={submit}
            disabled={createMut.isPending || !name.trim() || !slug.trim() || !ownerEmail.trim() || dependencyErrors.length > 0}
            className="rounded-lg bg-[var(--deck-accent)] px-3 py-1.5 text-xs font-medium text-white  disabled:opacity-50"
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
  if (active.length === 0) return <span className="text-xs text-[var(--deck-text-low)]">{t('noModules')}</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {active.map((m) => (
        <span key={m.key} className="rounded-full bg-[var(--deck-glass-fill-strong)] px-2 py-0.5 text-[11px] text-[var(--deck-text-mid)]">
          {t(`moduleNames.${m.key}`)}{m.status === 'TRIAL' ? ` (${t('status.TRIAL')})` : ''}
        </span>
      ))}
    </div>
  );
}

// P6b — surfaces the server-computed alert codes (SUSPENDED/NO_OWNER/MODULE_EXPIRING_SOON/
// SCREENS_OFFLINE) as small badges, so an operator scanning the list doesn't have to open every
// tenant to notice one needs attention. SUSPENDED is covered by the status pill already, so it's
// not duplicated here.
function AlertBadges({ alerts }: { alerts: TenantAlert[] }) {
  const t = useTranslations('adminTenants');
  const visible = alerts.filter((a) => a !== 'SUSPENDED');
  if (visible.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {visible.map((a) => (
        <span
          key={a}
          className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-400"
        >
          <AlertTriangle className="h-3 w-3" /> {t(`alerts.${a}`)}
        </span>
      ))}
    </div>
  );
}

const PAGE_SIZE = 25;

export default function AdminTenantsPage() {
  const locale = useLocale();
  const t = useTranslations('adminTenants');
  const tc = useTranslations('common');
  const { isSuperAdmin } = usePermissions();
  const canRender = useRouteGuard(isSuperAdmin);
  const [showCreate, setShowCreate] = useState(false);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<OrganizationStatus | ''>('');
  const [moduleKey, setModuleKey] = useState<ModuleKey | ''>('');
  const [sortBy, setSortBy] = useState<TenantListParams['sortBy']>('name');
  const [sortDir, setSortDir] = useState<TenantListParams['sortDir']>('asc');
  const [page, setPage] = useState(1);

  const params: TenantListParams = {
    search: search.trim() || undefined,
    status: status || undefined,
    moduleKey: moduleKey || undefined,
    sortBy,
    sortDir,
    page,
    pageSize: PAGE_SIZE,
  };

  const { data, isLoading } = useQuery({
    queryKey: ['admin-tenants', params],
    queryFn: () => platformTenantsApi.list(params),
    enabled: canRender,
    placeholderData: (prev) => prev,
  });
  const tenants = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function resetToFirstPage<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setPage(1);
    };
  }
  const onSearchChange = resetToFirstPage(setSearch);
  const onStatusChange = resetToFirstPage(setStatus);
  const onModuleChange = resetToFirstPage(setModuleKey);

  if (!canRender) return null;

  return (
    <div className="mx-auto max-w-6xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--deck-text-hi)]">{t('title')}</h1>
          <p className="mt-1 text-sm text-[var(--deck-text-mid)]">{t('subtitle')}</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 rounded-lg bg-[var(--deck-accent)] px-4 py-2 text-sm font-medium text-white "
        >
          <Plus className="h-4 w-4" /> {t('createTenant')}
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--deck-text-low)]" />
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t('search')}
            className={`${inputClass} w-56 ps-8`}
          />
        </div>
        <select value={status} onChange={(e) => onStatusChange(e.target.value as OrganizationStatus | '')} className={inputClass}>
          <option value="">{t('allStatuses')}</option>
          <option value="ACTIVE">{t('tenantStatus.ACTIVE')}</option>
          <option value="SUSPENDED">{t('tenantStatus.SUSPENDED')}</option>
        </select>
        <select value={moduleKey} onChange={(e) => onModuleChange(e.target.value as ModuleKey | '')} className={inputClass}>
          <option value="">{t('allModules')}</option>
          {MODULE_KEYS.map((k) => (
            <option key={k} value={k}>
              {t(`moduleNames.${k}`)}
            </option>
          ))}
        </select>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as TenantListParams['sortBy'])}
          className={inputClass}
        >
          <option value="name">{t('sortName')}</option>
          <option value="createdAt">{t('sortCreated')}</option>
        </select>
        <button
          onClick={() => setSortDir(sortDir === 'asc' ? 'desc' : 'asc')}
          title={sortDir}
          className="rounded-lg border border-[var(--deck-glass-border)] px-2.5 py-1.5 text-xs font-medium text-[var(--deck-text-hi)] hover:bg-[var(--deck-glass-fill-strong)]"
        >
          {sortDir === 'asc' ? '↑' : '↓'}
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--deck-glass-border)]">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-[var(--deck-glass-fill-strong)] text-left text-xs uppercase tracking-wide text-[var(--deck-text-mid)]">
            <tr>
              <th className="px-4 py-2">{tc('name')}</th>
              <th className="px-4 py-2">{t('statusLabel')}</th>
              <th className="px-4 py-2">{t('created')}</th>
              <th className="px-4 py-2">{t('columnOwner')}</th>
              <th className="px-4 py-2">{t('columnMembers')}</th>
              <th className="px-4 py-2">{t('columnScreens')}</th>
              <th className="px-4 py-2">{t('columnStorage')}</th>
              <th className="px-4 py-2">{t('modules')}</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--deck-glass-border-soft)]">
            {isLoading && !data && (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-[var(--deck-text-low)]">{tc('loading')}</td></tr>
            )}
            {!isLoading && tenants.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-[var(--deck-text-low)]">{t('empty')}</td></tr>
            )}
            {tenants.map((tenant) => (
              <tr key={tenant.id} className="align-top text-[var(--deck-text-hi)]">
                <td className="px-4 py-2">
                  <div className="font-medium">{tenant.name}</div>
                  <div className="text-xs text-[var(--deck-text-mid)]">{tenant.slug}</div>
                </td>
                <td className="px-4 py-2">
                  <div className="flex flex-col gap-1">
                    <span className={`w-fit rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[tenant.status]}`}>
                      {t(`tenantStatus.${tenant.status}`)}
                    </span>
                    <AlertBadges alerts={tenant.alerts} />
                  </div>
                </td>
                <td className="px-4 py-2 text-xs text-[var(--deck-text-mid)]">{new Date(tenant.createdAt).toLocaleDateString()}</td>
                <td className="px-4 py-2 text-xs">
                  {tenant.usage.owner ? (
                    <div>
                      <div className="text-[var(--deck-text-hi)]">{tenant.usage.owner.name}</div>
                      <div className="text-[var(--deck-text-mid)]">{tenant.usage.owner.email}</div>
                    </div>
                  ) : tenant.usage.pendingOwnerInvite ? (
                    <span className="text-[var(--deck-text-mid)]">{t('pendingOwner')}</span>
                  ) : (
                    <span className="text-amber-600 dark:text-amber-400">{t('noOwnerShort')}</span>
                  )}
                </td>
                <td className="px-4 py-2 text-xs text-[var(--deck-text-mid)]">
                  {tenant.usage.members.active}
                  {tenant.usage.members.pendingInvites > 0 && <span className="ms-1 text-[var(--deck-text-low)]">(+{tenant.usage.members.pendingInvites})</span>}
                </td>
                <td className="px-4 py-2 text-xs text-[var(--deck-text-mid)]">
                  {t('screensOnline', { online: tenant.usage.screens.online, total: tenant.usage.screens.total })}
                </td>
                <td className="px-4 py-2 text-xs text-[var(--deck-text-mid)]">{formatBytes(tenant.usage.storage.bytes)}</td>
                <td className="px-4 py-2"><ModuleSummary modules={tenant.modules} /></td>
                <td className="px-4 py-2 text-end">
                  <Link
                    href={`/${locale}/admin/tenants/${tenant.id}`}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[var(--deck-accent)] hover:bg-[var(--deck-accent-soft)]"
                  >
                    {t('manage')} <ChevronRight className="h-3 w-3" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {total > 0 && (
        <div className="mt-3 flex items-center justify-between text-xs text-[var(--deck-text-mid)]">
          <span>{t('showingOf', { shown: tenants.length, total })}</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-lg border border-[var(--deck-glass-border)] px-2.5 py-1 font-medium text-[var(--deck-text-hi)] hover:bg-[var(--deck-glass-fill-strong)] disabled:opacity-40"
            >
              {t('prevPage')}
            </button>
            <span>{t('pageOf', { page, totalPages })}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="rounded-lg border border-[var(--deck-glass-border)] px-2.5 py-1 font-medium text-[var(--deck-text-hi)] hover:bg-[var(--deck-glass-fill-strong)] disabled:opacity-40"
            >
              {t('nextPage')}
            </button>
          </div>
        </div>
      )}

      {showCreate && <CreateTenantModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}
