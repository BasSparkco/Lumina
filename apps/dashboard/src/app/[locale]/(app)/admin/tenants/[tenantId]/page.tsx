'use client';
import { use, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Link2, Pencil, ShieldOff, X } from 'lucide-react';
import { usePermissions } from '@/hooks/usePermissions';
import { useRouteGuard } from '@/hooks/useRouteGuard';
import { platformTenantsApi, type UserRole } from '@/lib/api';
import { ModuleAssignmentsEditor, defaultModuleAssignments, findDependencyErrors, type ModuleAssignmentDraft } from '@/components/ModuleAssignmentsEditor';
import type { OrganizationStatus } from '@lumina/types';

const inputClass =
  'w-full rounded-lg border border-[var(--deck-glass-border)] bg-[var(--deck-glass-fill-strong)] px-3 py-1.5 text-sm text-[var(--deck-text-hi)] focus:border-[var(--deck-accent)] focus:outline-none';

const STATUS_STYLES: Record<OrganizationStatus, string> = {
  ACTIVE: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400',
  SUSPENDED: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
};

const ROLES: UserRole[] = ['OWNER', 'ADMIN', 'EDITOR', 'VIEWER'];

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
  const { data: auditEntries } = useQuery({
    queryKey: ['admin-tenants', tenantId, 'audit'],
    queryFn: () => platformTenantsApi.listAuditLog(tenantId),
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
    <div className="mx-auto max-w-3xl p-8">
      <Link href={`/${locale}/admin/tenants`} className="mb-4 inline-flex items-center gap-1 text-xs font-medium text-[var(--deck-text-mid)] hover:text-[var(--deck-text-hi)]">
        <ArrowLeft className="h-3.5 w-3.5" /> {t('backToTenants')}
      </Link>

      {isLoading && <p className="text-sm text-[var(--deck-text-low)]">{tc('loading')}</p>}

      {tenant && (
        <>
          <div className="mb-2 flex items-center justify-between">
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
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[tenant.status]}`}>{t(`tenantStatus.${tenant.status}`)}</span>
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

          <section className="mb-8 rounded-xl border border-[var(--deck-glass-border)] p-4">
            <h2 className="mb-3 text-sm font-semibold text-[var(--deck-text-hi)]">{t('modules')}</h2>
            <ModuleAssignmentsEditor value={draft} onChange={setModules} />
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
            <h2 className="mb-1 text-sm font-semibold text-[var(--deck-text-hi)]">{t('auditSection')}</h2>
            {!auditEntries?.length ? (
              <p className="text-xs text-[var(--deck-text-low)]">{t('noAuditEntries')}</p>
            ) : (
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
            )}
          </section>
        </>
      )}
    </div>
  );
}
