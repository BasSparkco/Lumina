'use client';
import { use, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Check, Link2, Monitor, Pencil, ShieldOff, X } from 'lucide-react';
import { usePermissions } from '@/hooks/usePermissions';
import { useRouteGuard } from '@/hooks/useRouteGuard';
import { platformTenantsApi, type TenantAlert, type UserRole } from '@/lib/api';
import { ModuleAssignmentsEditor, defaultModuleAssignments, findDependencyErrors, type ModuleAssignmentDraft } from '@/components/ModuleAssignmentsEditor';
import { formatBytes } from '@/lib/formatBytes';
import type { OrganizationStatus } from '@lumina/types';

const inputClass =
  'w-full rounded-lg border border-[var(--deck-glass-border)] bg-[var(--deck-glass-fill-strong)] px-3 py-1.5 text-sm text-[var(--deck-text-hi)] focus:border-[var(--deck-accent)] focus:outline-none';

const STATUS_STYLES: Record<OrganizationStatus, string> = {
  ACTIVE: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400',
  SUSPENDED: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
};

const SCREEN_STATUS_STYLES: Record<'ONLINE' | 'OFFLINE', string> = {
  ONLINE: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400',
  OFFLINE: 'bg-[var(--deck-glass-fill-strong)] text-[var(--deck-text-mid)]',
};

const ROLES: UserRole[] = ['OWNER', 'ADMIN', 'EDITOR', 'VIEWER'];
const AUDIT_PAGE_SIZE = 25;

function StatTile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-lg border border-[var(--deck-glass-border)] p-3">
      <div className="text-xs text-[var(--deck-text-mid)]">{label}</div>
      <div className="mt-1 text-lg font-semibold text-[var(--deck-text-hi)]">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-[var(--deck-text-low)]">{sub}</div>}
    </div>
  );
}

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
  const { data: members } = useQuery({
    queryKey: ['admin-tenants', tenantId, 'members'],
    queryFn: () => platformTenantsApi.listMembers(tenantId),
    enabled: canRender,
  });
  const { data: invites } = useQuery({
    queryKey: ['admin-tenants', tenantId, 'invites'],
    queryFn: () => platformTenantsApi.listInvites(tenantId),
    enabled: canRender,
  });
  const [auditPage, setAuditPage] = useState(1);
  const [auditFilter, setAuditFilter] = useState('');
  const { data: auditResult } = useQuery({
    queryKey: ['admin-tenants', tenantId, 'audit', auditPage, auditFilter],
    queryFn: () => platformTenantsApi.listAuditLog(tenantId, { page: auditPage, pageSize: AUDIT_PAGE_SIZE, action: auditFilter.trim() || undefined }),
    enabled: canRender,
    placeholderData: (prev) => prev,
  });
  const auditEntries = auditResult?.items ?? [];
  const auditTotalPages = Math.max(1, Math.ceil((auditResult?.total ?? 0) / AUDIT_PAGE_SIZE));

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
    mutationFn: ({ status, reason }: { status: OrganizationStatus; reason?: string }) => platformTenantsApi.updateStatus(tenantId, status, reason),
    onSuccess: invalidateAfterChange,
  });

  const nameMut = useMutation({
    mutationFn: (name: string) => platformTenantsApi.updateName(tenantId, name),
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
    onSuccess: (invite) => {
      setInviteResult({ token: invite.token });
      void qc.invalidateQueries({ queryKey: ['admin-tenants', tenantId, 'invites'] });
    },
  });

  const revokeInviteMut = useMutation({
    mutationFn: (inviteId: string) => platformTenantsApi.revokeOwnerInvite(tenantId, inviteId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-tenants', tenantId, 'invites'] }),
  });

  const memberRoleMut = useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: UserRole }) => platformTenantsApi.updateMemberRole(tenantId, memberId, role),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-tenants', tenantId, 'members'] }),
  });

  const removeMemberMut = useMutation({
    mutationFn: (memberId: string) => platformTenantsApi.removeMember(tenantId, memberId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-tenants', tenantId, 'members'] }),
  });

  const revokeMemberSessionsMut = useMutation({
    mutationFn: (memberId: string) => platformTenantsApi.revokeMemberSessions(tenantId, memberId),
  });

  const revokeAllSessionsMut = useMutation({
    mutationFn: () => platformTenantsApi.revokeAllSessions(tenantId),
  });

  function toggleStatus() {
    if (!tenant) return;
    if (tenant.status === 'ACTIVE') {
      const reason = window.prompt(t('suspendReasonPrompt', { name: tenant.name }));
      if (reason === null) return;
      if (!reason.trim()) {
        window.alert(t('suspendReasonRequired'));
        return;
      }
      if (window.confirm(t('suspendConfirm', { name: tenant.name }))) statusMut.mutate({ status: 'SUSPENDED', reason: reason.trim() });
    } else {
      if (window.confirm(t('activateConfirm', { name: tenant.name }))) statusMut.mutate({ status: 'ACTIVE' });
    }
  }

  function editName() {
    if (!tenant) return;
    const name = window.prompt(t('tenantNamePrompt'), tenant.name);
    if (name && name.trim() && name.trim() !== tenant.name) nameMut.mutate(name.trim());
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
    <div className="signal-page signal-workspace-page signal-admin-tenants-detail-page space-y-6">
      <Link href={`/${locale}/admin/tenants`} className="mb-4 inline-flex items-center gap-1 text-xs font-medium text-[var(--deck-text-mid)] hover:text-[var(--deck-text-hi)]">
        <ArrowLeft className="h-3.5 w-3.5" /> {t('backToTenants')}
      </Link>

      {isLoading && <p className="text-sm text-[var(--deck-text-low)]">{tc('loading')}</p>}

      {tenant && (
        <>
          <div className="signal-page-heading">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold text-[var(--deck-text-hi)]">{tenant.name}</h1>
                <button onClick={editName} title={t('editName')} className="text-[var(--deck-text-low)] hover:text-[var(--deck-text-hi)]">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="mt-1 text-sm text-[var(--deck-text-mid)]">{tenant.slug}</p>
              <p className="mt-1 text-xs text-[var(--deck-text-low)]">
                {t('owner')}: {tenant.owner ? `${tenant.owner.name} (${tenant.owner.email})` : t('noOwner')}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex flex-col items-end gap-1">
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[tenant.status]}`}>{t(`tenantStatus.${tenant.status}`)}</span>
                <AlertBadges alerts={tenant.alerts} />
              </div>
              <button
                onClick={toggleStatus}
                disabled={statusMut.isPending}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
                  tenant.status === 'ACTIVE'
                    ? 'border border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/30'
                    : 'deck-btn-primary'
                }`}
              >
                {tenant.status === 'ACTIVE' ? t('suspendTenant') : t('activateTenant')}
              </button>
            </div>
          </div>
          {tenant.status === 'SUSPENDED' && tenant.suspensionReason && (
            <p className="mb-6 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-400">
              {t('suspensionReason')}: {tenant.suspensionReason}
            </p>
          )}
          {tenant.status !== 'SUSPENDED' && <div className="mb-6" />}

          {/* P6b (docs/tenant_isolation_and_platform_admin_plan.md §"Operational tenant detail") */}
          <section className="mb-8 rounded-xl border border-[var(--deck-glass-border)] p-4">
            <h2 className="mb-3 text-sm font-semibold text-[var(--deck-text-hi)]">{t('overviewSection')}</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile
                label={t('overviewScreens')}
                value={`${tenant.usage.screens.online}/${tenant.usage.screens.total}`}
                sub={`${tenant.usage.screens.online} ${t('overviewOnline')} · ${tenant.usage.screens.offline} ${t('overviewOffline')}`}
              />
              <StatTile label={t('columnMembers')} value={tenant.usage.members.active} sub={tenant.usage.members.pendingInvites > 0 ? `+${tenant.usage.members.pendingInvites}` : undefined} />
              <StatTile label={t('overviewAssets')} value={tenant.usage.storage.assetsCount} />
              <StatTile label={t('overviewStorage')} value={formatBytes(tenant.usage.storage.bytes)} />
              <StatTile label={t('overviewPlaylists')} value={tenant.usage.content.playlists} />
              <StatTile label={t('overviewDesigns')} value={tenant.usage.content.designs} />
              <StatTile label={t('overviewRooms')} value={tenant.usage.content.rooms} />
              <StatTile label={t('overviewBuildings')} value={tenant.usage.content.buildings} />
            </div>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-[var(--deck-text-mid)]">
              <span>
                {t('lastUserActivity')}: {tenant.usage.lastUserActivityAt ? new Date(tenant.usage.lastUserActivityAt).toLocaleString(locale) : t('never')}
              </span>
              <span>
                {t('lastScreenHeartbeat')}: {tenant.usage.lastScreenHeartbeatAt ? new Date(tenant.usage.lastScreenHeartbeatAt).toLocaleString(locale) : t('never')}
              </span>
            </div>
          </section>

          <section className="mb-8 rounded-xl border border-[var(--deck-glass-border)] p-4">
            <h2 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-[var(--deck-text-hi)]">
              <Monitor className="h-3.5 w-3.5" /> {t('screensSection')}
            </h2>
            {tenant.screens.length === 0 ? (
              <p className="text-xs text-[var(--deck-text-low)]">{t('noScreens')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="mt-2 w-full text-left text-xs">
                  <thead>
                    <tr className="text-[var(--deck-text-low)]">
                      <th className="pb-1 pe-2 font-medium">{t('screenName')}</th>
                      <th className="pb-1 pe-2 font-medium">{t('screenStatus')}</th>
                      <th className="pb-1 pe-2 font-medium">{t('screenLastSeen')}</th>
                      <th className="pb-1 pe-2 font-medium">{t('screenSync')}</th>
                      <th className="pb-1 font-medium">{t('screenStorage')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tenant.screens.map((s) => (
                      <tr key={s.id} className="border-t border-[var(--deck-glass-border)]">
                        <td className="py-2 pe-2 font-medium text-[var(--deck-text-hi)]">{s.name}</td>
                        <td className="py-2 pe-2">
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${SCREEN_STATUS_STYLES[s.status]}`}>{s.status}</span>
                        </td>
                        <td className="py-2 pe-2 text-[var(--deck-text-mid)]">{s.lastSeenAt ? new Date(s.lastSeenAt).toLocaleString(locale) : t('never')}</td>
                        <td className="py-2 pe-2 text-[var(--deck-text-mid)]">{s.syncState}</td>
                        <td className="py-2 text-[var(--deck-text-mid)]">{formatBytes(Number(s.cacheBytes))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="mb-8 rounded-xl border border-[var(--deck-glass-border)] p-4">
            <h2 className="mb-3 text-sm font-semibold text-[var(--deck-text-hi)]">{t('contentStorageSection')}</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {tenant.content.byAssetType.map((row) => (
                <StatTile key={row.type} label={t(`assetType.${row.type}`)} value={row.count} sub={formatBytes(row.bytes)} />
              ))}
            </div>
          </section>

          <section className="mb-8 rounded-xl border border-[var(--deck-glass-border)] p-4">
            <h2 className="mb-3 text-sm font-semibold text-[var(--deck-text-hi)]">{t('modules')}</h2>
            <ModuleAssignmentsEditor value={draft} onChange={setModules} />
            {/* P6b — "usage counters" alongside P6a's entitlement controls: how many of this
                tenant's screens actually exercise each player-facing module today. */}
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--deck-text-low)]">
              {(['WAYFINDING', 'WAYFINDING_AI', 'ROOM_BOOKING'] as const).map((key) =>
                tenant.moduleUsage[key] > 0 ? (
                  <span key={key}>
                    {t(`moduleNames.${key}`)}: {t('moduleUsageHint', { count: tenant.moduleUsage[key] })}
                  </span>
                ) : null,
              )}
            </div>
            {modulesMut.error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{(modulesMut.error as Error).message}</p>}
            <div className="mt-3 flex justify-end gap-2">
              {modules && (
                <button onClick={() => setModules(null)} className="rounded-lg border border-[var(--deck-glass-border)] px-3 py-1.5 text-xs font-medium text-[var(--deck-text-hi)] hover:bg-[var(--deck-glass-fill-strong)]">
                  {tc('cancel')}
                </button>
              )}
              <button
                onClick={() => modulesMut.mutate(draft)}
                disabled={!modules || modulesMut.isPending || dependencyErrors.length > 0}
                className="rounded-lg bg-[var(--deck-accent)] px-3 py-1.5 text-xs font-medium text-white  disabled:opacity-50"
              >
                {modulesMut.isPending ? tc('loading') : t('saveModules')}
              </button>
            </div>
          </section>

          <section className="mb-8 rounded-xl border border-[var(--deck-glass-border)] p-4">
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[var(--deck-text-hi)]">{t('membersSection')}</h2>
              {!!members?.length && (
                <button
                  onClick={() => {
                    if (window.confirm(t('revokeAllSessionsConfirm'))) revokeAllSessionsMut.mutate();
                  }}
                  disabled={revokeAllSessionsMut.isPending}
                  className="flex items-center gap-1 text-xs font-medium text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
                >
                  <ShieldOff className="h-3.5 w-3.5" /> {t('revokeAllSessions')}
                </button>
              )}
            </div>
            {!members?.length ? (
              <p className="text-xs text-[var(--deck-text-low)]">{t('noMembers')}</p>
            ) : (
              <table className="mt-2 w-full text-left text-xs">
                <tbody>
                  {members.map((m) => (
                    <tr key={m.id} className="border-t border-[var(--deck-glass-border)]">
                      <td className="py-2 pe-2">
                        <div className="font-medium text-[var(--deck-text-hi)]">{m.name}</div>
                        <div className="text-[var(--deck-text-low)]">{m.email}</div>
                      </td>
                      <td className="py-2 pe-2">
                        <select
                          value={m.role}
                          onChange={(e) => memberRoleMut.mutate({ memberId: m.id, role: e.target.value as UserRole })}
                          disabled={memberRoleMut.isPending}
                          className="rounded border border-[var(--deck-glass-border)] bg-[var(--deck-glass-fill-strong)] px-1.5 py-1 text-xs text-[var(--deck-text-hi)]"
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 text-end">
                        <button
                          onClick={() => {
                            if (window.confirm(t('revokeSessionsConfirm', { name: m.name }))) revokeMemberSessionsMut.mutate(m.id);
                          }}
                          className="me-3 text-[var(--deck-text-mid)] hover:text-[var(--deck-text-hi)]"
                        >
                          {t('revokeSessions')}
                        </button>
                        <button
                          onClick={() => {
                            if (window.confirm(t('removeMemberConfirm', { name: m.name }))) removeMemberMut.mutate(m.id);
                          }}
                          className="text-red-600 hover:underline dark:text-red-400"
                        >
                          {t('removeMember')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="mb-8 rounded-xl border border-[var(--deck-glass-border)] p-4">
            <h2 className="mb-1 text-sm font-semibold text-[var(--deck-text-hi)]">{t('invitesSection')}</h2>
            {!invites?.length ? (
              <p className="text-xs text-[var(--deck-text-low)]">{t('noInvites')}</p>
            ) : (
              <table className="mt-2 w-full text-left text-xs">
                <tbody>
                  {invites.map((inv) => (
                    <tr key={inv.id} className="border-t border-[var(--deck-glass-border)]">
                      <td className="py-2 pe-2 text-[var(--deck-text-hi)]">{inv.email}</td>
                      <td className="py-2 pe-2 text-[var(--deck-text-mid)]">{inv.role}</td>
                      <td className="py-2 text-end">
                        <button
                          onClick={() => {
                            if (window.confirm(t('revokeInviteConfirm', { email: inv.email }))) revokeInviteMut.mutate(inv.id);
                          }}
                          className="text-red-600 hover:underline dark:text-red-400"
                        >
                          {t('revokeInvite')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="mb-8 rounded-xl border border-[var(--deck-glass-border)] p-4">
            <h2 className="mb-1 text-sm font-semibold text-[var(--deck-text-hi)]">{t('ownerInvite')}</h2>
            <p className="mb-3 text-xs text-[var(--deck-text-mid)]">{t('ownerInviteHint')}</p>
            {inviteResult ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={copyInviteLink}
                  className="flex items-center gap-2 rounded-lg border border-[var(--deck-glass-border)] px-3 py-1.5 text-xs font-medium text-[var(--deck-text-hi)] hover:bg-[var(--deck-glass-fill-strong)]"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Link2 className="h-3.5 w-3.5" />}
                  {copied ? t('copied') : t('copyInviteLink')}
                </button>
                <button onClick={() => setInviteResult(null)} className="text-[var(--deck-text-low)] hover:text-[var(--deck-text-hi)]">
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
                  className="shrink-0 rounded-lg bg-[var(--deck-accent)] px-3 py-1.5 text-xs font-medium text-white  disabled:opacity-50"
                >
                  {inviteMut.isPending ? tc('loading') : t('sendOwnerInvite')}
                </button>
              </div>
            )}
            {inviteMut.error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{(inviteMut.error as Error).message}</p>}
          </section>

          <section className="rounded-xl border border-[var(--deck-glass-border)] p-4">
            <div className="mb-1 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-[var(--deck-text-hi)]">{t('auditSection')}</h2>
              <input
                value={auditFilter}
                onChange={(e) => {
                  setAuditFilter(e.target.value);
                  setAuditPage(1);
                }}
                placeholder={t('auditFilterPlaceholder')}
                className={`${inputClass} w-48 py-1`}
              />
            </div>
            {!auditEntries.length ? (
              <p className="text-xs text-[var(--deck-text-low)]">{t('noAuditEntries')}</p>
            ) : (
              <>
                <table className="mt-2 w-full text-left text-xs">
                  <thead>
                    <tr className="text-[var(--deck-text-low)]">
                      <th className="pb-1 font-medium">{t('auditWhen')}</th>
                      <th className="pb-1 font-medium">{t('auditActor')}</th>
                      <th className="pb-1 font-medium">{t('auditAction')}</th>
                      <th className="pb-1 font-medium">{t('auditReason')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditEntries.map((entry) => (
                      <tr key={entry.id} className="border-t border-[var(--deck-glass-border)]">
                        <td className="py-2 pe-2 whitespace-nowrap text-[var(--deck-text-mid)]">{new Date(entry.createdAt).toLocaleString(locale)}</td>
                        <td className="py-2 pe-2 text-[var(--deck-text-hi)]">{entry.actor?.name ?? t('platformSuperAdmin')}</td>
                        <td className="py-2 pe-2 font-mono text-[var(--deck-text-hi)]">{entry.action}</td>
                        <td className="py-2 text-[var(--deck-text-mid)]">{entry.reason ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {auditTotalPages > 1 && (
                  <div className="mt-3 flex items-center justify-end gap-2 text-xs text-[var(--deck-text-mid)]">
                    <button
                      onClick={() => setAuditPage((p) => Math.max(1, p - 1))}
                      disabled={auditPage <= 1}
                      className="rounded-lg border border-[var(--deck-glass-border)] px-2.5 py-1 font-medium text-[var(--deck-text-hi)] hover:bg-[var(--deck-glass-fill-strong)] disabled:opacity-40"
                    >
                      {t('prevPage')}
                    </button>
                    <span>{t('pageOf', { page: auditPage, totalPages: auditTotalPages })}</span>
                    <button
                      onClick={() => setAuditPage((p) => Math.min(auditTotalPages, p + 1))}
                      disabled={auditPage >= auditTotalPages}
                      className="rounded-lg border border-[var(--deck-glass-border)] px-2.5 py-1 font-medium text-[var(--deck-text-hi)] hover:bg-[var(--deck-glass-fill-strong)] disabled:opacity-40"
                    >
                      {t('nextPage')}
                    </button>
                  </div>
                )}
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
