'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Users, UserPlus, Trash2, Mail, Link2, Check, Search } from 'lucide-react';
import { membersApi, type Member, type PendingInvite, type UserRole } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import { useConfirmBeforeDelete } from '@/hooks/useConfirmBeforeDelete';
import { useRouteGuard } from '@/hooks/useRouteGuard';
import { useAuditLog } from '@/hooks/useAuditLog';

const ROLES: UserRole[] = ['OWNER', 'ADMIN', 'EDITOR', 'VIEWER'];

const ROLE_STYLES: Record<UserRole, string> = {
  OWNER: 'bg-[var(--deck-accent-soft)] text-[var(--deck-accent)]',
  ADMIN: 'bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300',
  EDITOR: 'bg-teal-100 dark:bg-teal-950 text-teal-700 dark:text-teal-300',
  VIEWER: 'bg-[var(--deck-glass-fill-strong)] text-[var(--deck-text-mid)]',
};

// A real User and a real OrgInvite are genuinely different shapes (no `name`/`createdAt`-as-
// joined-date on a pending invite, no `token`/`expiresAt` on a member) — this union is what the
// list renders/searches over instead of one unified mock type.
type MemberRow = { kind: 'member'; member: Member } | { kind: 'invite'; invite: PendingInvite };

export default function MembersPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const locale = useLocale();
  const { canManageMembers } = usePermissions();
  const canRender = useRouteGuard(canManageMembers);
  const { confirmDelete } = useConfirmBeforeDelete();
  const logAction = useAuditLog();
  const t = useTranslations('members');
  const tc = useTranslations('common');

  const membersKey = ['members', user?.orgId];
  const invitesKey = ['members', 'invites', user?.orgId];
  const { data: members = [], isLoading: membersLoading } = useQuery({ queryKey: membersKey, queryFn: membersApi.list, enabled: canRender });
  const { data: invites = [], isLoading: invitesLoading } = useQuery({ queryKey: invitesKey, queryFn: membersApi.listInvites, enabled: canRender });
  const isLoading = membersLoading || invitesLoading;

  const rows: MemberRow[] = [
    ...members.map((member): MemberRow => ({ kind: 'member', member })),
    ...invites.map((invite): MemberRow => ({ kind: 'invite', invite })),
  ];

  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('EDITOR');
  const [inviteError, setInviteError] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const filteredRows = rows.filter((row) => {
    const q = search.toLowerCase();
    const email = row.kind === 'member' ? row.member.email : row.invite.email;
    const name = row.kind === 'member' ? row.member.name : '';
    return name.toLowerCase().includes(q) || email.toLowerCase().includes(q);
  });

  function copyInviteLink(invite: PendingInvite) {
    const url = `${window.location.origin}/${locale}/accept-invite?token=${invite.token}`;
    void navigator.clipboard.writeText(url);
    setCopiedId(invite.id);
    setTimeout(() => setCopiedId(id => (id === invite.id ? null : id)), 2000);
  }

  const inviteMut = useMutation({
    mutationFn: () => membersApi.invite(inviteEmail.trim(), inviteRole),
    onSuccess: (created) => {
      logAction({
        resourceType: 'MEMBER', resourceName: created.email, action: 'INVITE',
        userName: user?.name ?? '', userEmail: user?.email ?? '', detail: created.role,
      });
      void qc.invalidateQueries({ queryKey: invitesKey });
      setShowInvite(false);
      setInviteEmail('');
      setInviteRole('EDITOR');
      setInviteError('');
    },
    onError: (e: Error) => setInviteError(e.message),
  });

  const roleMut = useMutation({
    mutationFn: ({ id, role }: { id: string; role: UserRole }) => membersApi.updateRole(id, role),
    onSuccess: (updated) => {
      logAction({
        resourceType: 'MEMBER', resourceName: updated.email, action: 'ROLE_CHANGE',
        userName: user?.name ?? '', userEmail: user?.email ?? '', detail: updated.role,
      });
      void qc.invalidateQueries({ queryKey: membersKey });
    },
  });

  const removeMut = useMutation({
    mutationFn: (member: Member) => membersApi.remove(member.id),
    onSuccess: (_data, member) => {
      logAction({
        resourceType: 'MEMBER', resourceName: member.email, action: 'REMOVE',
        userName: user?.name ?? '', userEmail: user?.email ?? '',
      });
      qc.setQueryData<Member[]>(membersKey, (old) => old?.filter(m => m.id !== member.id));
      void qc.invalidateQueries({ queryKey: membersKey });
    },
  });

  const revokeMut = useMutation({
    mutationFn: (invite: PendingInvite) => membersApi.revokeInvite(invite.id),
    onSuccess: (_data, invite) => {
      qc.setQueryData<PendingInvite[]>(invitesKey, (old) => old?.filter(i => i.id !== invite.id));
      void qc.invalidateQueries({ queryKey: invitesKey });
    },
  });

  if (!canRender) return null;

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--deck-text-hi)]">{t('title')}</h1>
          <p className="text-sm text-[var(--deck-text-mid)] mt-1">{t('subtitle')}</p>
        </div>
        <button onClick={() => { setShowInvite(true); setInviteError(''); }}
          className="flex items-center gap-2 bg-[var(--deck-accent)] text-white px-4 py-2 rounded-lg text-sm font-medium ">
          <UserPlus className="w-4 h-4" /> {t('inviteMember')}
        </button>
      </div>

      {/* Invite modal */}
      {showInvite && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="glass-popup rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <h2 className="font-semibold text-[var(--deck-text-hi)] mb-4 flex items-center gap-2">
              <Mail className="w-4 h-4 text-[var(--deck-accent)]" /> {t('inviteByEmail')}
            </h2>
            <label className="text-xs text-[var(--deck-text-mid)] block mb-1">{t('emailAddress')}</label>
            <input value={inviteEmail} onChange={e => { setInviteEmail(e.target.value); setInviteError(''); }}
              placeholder={t('emailPlaceholder')} type="email"
              className="w-full border border-[var(--deck-glass-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--deck-accent)] mb-3" />
            <label className="text-xs text-[var(--deck-text-mid)] block mb-1">{t('role')}</label>
            <select value={inviteRole} onChange={e => setInviteRole(e.target.value as UserRole)}
              className="w-full border border-[var(--deck-glass-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--deck-accent)] mb-2">
              {ROLES.filter(r => r !== 'OWNER').map(r => <option key={r} value={r}>{tc(`roles.${r}`)}</option>)}
            </select>
            {inviteError && <p className="text-xs text-red-600 mb-2">{inviteError}</p>}
            <div className="flex gap-2 mt-3">
              <button onClick={() => setShowInvite(false)}
                className="flex-1 border border-[var(--deck-glass-border)] text-[var(--deck-text-hi)] py-2 rounded-lg text-sm hover:bg-[var(--deck-glass-fill-strong)]">{tc('cancel')}</button>
              <button onClick={() => inviteMut.mutate()} disabled={!inviteEmail.trim() || inviteMut.isPending}
                className="flex-1 bg-[var(--deck-accent)] text-white py-2 rounded-lg text-sm font-medium  disabled:opacity-50">
                {inviteMut.isPending ? t('sending') : t('sendInvite')}
              </button>
            </div>
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <div className="relative mb-4 max-w-sm">
          <Search className="w-4 h-4 text-[var(--deck-text-low)] absolute start-2.5 top-1/2 -translate-y-1/2" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder={tc('search')}
            className="w-full border border-[var(--deck-glass-border)] rounded-lg ps-8 pe-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--deck-accent)]" />
        </div>
      )}

      {isLoading && <p className="text-sm text-[var(--deck-text-low)]">{t('loading')}</p>}

      {!isLoading && rows.length === 0 && (
        <div className="text-center py-16 text-[var(--deck-text-low)]">
          <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{t('empty')}</p>
        </div>
      )}

      {!isLoading && rows.length > 0 && filteredRows.length === 0 && (
        <div className="text-center py-16 text-[var(--deck-text-low)]">
          <Search className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{tc('noMatches')}</p>
        </div>
      )}

      {filteredRows.length > 0 && (
        <div className="glass-panel rounded-2xl border border-[var(--deck-glass-border)] divide-y divide-[var(--deck-glass-border-soft)]">
          {filteredRows.map((row) => {
            if (row.kind === 'invite') {
              const { invite } = row;
              return (
                <div key={`invite-${invite.id}`} className="flex items-center justify-between px-5 py-3.5">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400 flex items-center justify-center text-xs font-semibold shrink-0">
                      {invite.email.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-[var(--deck-text-hi)] truncate">{invite.email}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 font-medium">{t('invited')}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <button onClick={() => copyInviteLink(invite)}
                      title={t('copyInviteLink')}
                      className="flex items-center gap-1 text-xs text-[var(--deck-text-low)] hover:text-[var(--deck-accent)] transition-colors">
                      {copiedId === invite.id ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Link2 className="w-3.5 h-3.5" />}
                      {copiedId === invite.id ? t('copied') : t('copyLink')}
                    </button>
                    <span className={`text-xs px-2 py-1 rounded-lg font-medium ${ROLE_STYLES[invite.role]}`}>{tc(`roles.${invite.role}`)}</span>
                    <button onClick={() => { if (confirmDelete(t('revokeConfirm', { email: invite.email }))) revokeMut.mutate(invite); }}
                      title={t('revokeInvite')}
                      className="p-1 text-[var(--deck-text-low)] hover:text-red-500 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            }

            const { member } = row;
            const isSelf = member.email === user?.email;
            const isOwner = member.role === 'OWNER';
            return (
              <div key={member.id} className="flex items-center justify-between px-5 py-3.5">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-[var(--deck-accent-soft)] text-[var(--deck-accent)] flex items-center justify-center text-xs font-semibold shrink-0">
                    {member.name.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-[var(--deck-text-hi)] truncate">{member.name}</span>
                      {isSelf && <span className="text-[10px] text-[var(--deck-text-low)]">{t('you')}</span>}
                    </div>
                    <span className="text-xs text-[var(--deck-text-mid)] truncate">{member.email}</span>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  {isOwner ? (
                    <span className={`text-xs px-2 py-1 rounded-lg font-medium ${ROLE_STYLES[member.role]}`}>{tc(`roles.${member.role}`)}</span>
                  ) : (
                    <select value={member.role} disabled={roleMut.isPending}
                      onChange={e => roleMut.mutate({ id: member.id, role: e.target.value as UserRole })}
                      className={`text-xs px-2 py-1 rounded-lg font-medium border-0 focus:outline-none focus:ring-2 focus:ring-[var(--deck-accent)] ${ROLE_STYLES[member.role]}`}>
                      {ROLES.filter(r => r !== 'OWNER').map(r => <option key={r} value={r}>{tc(`roles.${r}`)}</option>)}
                    </select>
                  )}
                  <button onClick={() => { if (confirmDelete(t('removeConfirm', { name: member.name }))) removeMut.mutate(member); }}
                    disabled={isOwner || isSelf}
                    title={isOwner ? t('ownerCannotBeRemoved') : t('removeMember')}
                    className="p-1 text-[var(--deck-text-low)] hover:text-red-500 disabled:opacity-30 disabled:hover:text-[var(--deck-text-low)] dark:disabled:hover:text-[var(--deck-text-mid)] transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
