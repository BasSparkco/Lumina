'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Users, UserPlus, Trash2, Mail, Link2, Check } from 'lucide-react';
import { membersApi, type Member } from '@/lib/mocks/members';
import type { UserRole } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import { useConfirmBeforeDelete } from '@/hooks/useConfirmBeforeDelete';
import { useRouteGuard } from '@/hooks/useRouteGuard';
import { useAuditLog } from '@/hooks/useAuditLog';

const ROLES: UserRole[] = ['OWNER', 'ADMIN', 'EDITOR', 'VIEWER'];

const ROLE_STYLES: Record<UserRole, string> = {
  OWNER: 'bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300',
  ADMIN: 'bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300',
  EDITOR: 'bg-teal-100 dark:bg-teal-950 text-teal-700 dark:text-teal-300',
  VIEWER: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400',
};

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
  const { data: members = [], isLoading } = useQuery({ queryKey: ['members'], queryFn: membersApi.list, enabled: canRender });

  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('EDITOR');
  const [inviteError, setInviteError] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  function copyInviteLink(member: Member) {
    if (!member.inviteToken) return;
    const url = `${window.location.origin}/${locale}/accept-invite?token=${member.inviteToken}`;
    void navigator.clipboard.writeText(url);
    setCopiedId(member.id);
    setTimeout(() => setCopiedId(id => (id === member.id ? null : id)), 2000);
  }

  const inviteMut = useMutation({
    mutationFn: () => membersApi.invite(inviteEmail.trim(), inviteRole),
    onSuccess: (created) => {
      logAction({
        resourceType: 'MEMBER', resourceName: created.email, action: 'INVITE',
        userName: user?.name ?? '', userEmail: user?.email ?? '', detail: created.role,
      });
      void qc.invalidateQueries({ queryKey: ['members'] });
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
      void qc.invalidateQueries({ queryKey: ['members'] });
    },
  });

  const removeMut = useMutation({
    mutationFn: (member: Member) => membersApi.remove(member.id),
    onSuccess: (_data, member) => {
      logAction({
        resourceType: 'MEMBER', resourceName: member.email, action: 'REMOVE',
        userName: user?.name ?? '', userEmail: user?.email ?? '',
      });
      qc.setQueryData<Member[]>(['members'], (old) => old?.filter(m => m.id !== member.id));
      void qc.invalidateQueries({ queryKey: ['members'] });
    },
  });

  if (!canRender) return null;

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('subtitle')}</p>
        </div>
        <button onClick={() => { setShowInvite(true); setInviteError(''); }}
          className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">
          <UserPlus className="w-4 h-4" /> {t('inviteMember')}
        </button>
      </div>

      {/* Invite modal */}
      {showInvite && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-900 rounded-xl p-6 w-full max-w-sm shadow-xl">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
              <Mail className="w-4 h-4 text-indigo-600" /> {t('inviteByEmail')}
            </h2>
            <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">{t('emailAddress')}</label>
            <input value={inviteEmail} onChange={e => { setInviteEmail(e.target.value); setInviteError(''); }}
              placeholder={t('emailPlaceholder')} type="email"
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-3" />
            <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">{t('role')}</label>
            <select value={inviteRole} onChange={e => setInviteRole(e.target.value as UserRole)}
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-2">
              {ROLES.filter(r => r !== 'OWNER').map(r => <option key={r} value={r}>{tc(`roles.${r}`)}</option>)}
            </select>
            {inviteError && <p className="text-xs text-red-600 mb-2">{inviteError}</p>}
            <div className="flex gap-2 mt-3">
              <button onClick={() => setShowInvite(false)}
                className="flex-1 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 py-2 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-800">{tc('cancel')}</button>
              <button onClick={() => inviteMut.mutate()} disabled={!inviteEmail.trim() || inviteMut.isPending}
                className="flex-1 bg-indigo-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
                {inviteMut.isPending ? t('sending') : t('sendInvite')}
              </button>
            </div>
          </div>
        </div>
      )}

      {isLoading && <p className="text-sm text-gray-400">{t('loading')}</p>}

      {!isLoading && members.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{t('empty')}</p>
        </div>
      )}

      {members.length > 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
          {members.map((member: Member) => {
            const isSelf = member.email === user?.email;
            const isOwner = member.role === 'OWNER';
            return (
              <div key={member.id} className="flex items-center justify-between px-5 py-3.5">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-xs font-semibold shrink-0">
                    {member.name.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{member.name}</span>
                      {member.status === 'INVITED' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 font-medium">{t('invited')}</span>
                      )}
                      {isSelf && <span className="text-[10px] text-gray-400 dark:text-gray-500">{t('you')}</span>}
                    </div>
                    <span className="text-xs text-gray-500 dark:text-gray-400 truncate">{member.email}</span>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  {member.status === 'INVITED' && (
                    <button onClick={() => copyInviteLink(member)}
                      title={t('copyInviteLink')}
                      className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500 hover:text-indigo-600 transition-colors">
                      {copiedId === member.id ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Link2 className="w-3.5 h-3.5" />}
                      {copiedId === member.id ? t('copied') : t('copyLink')}
                    </button>
                  )}
                  {isOwner ? (
                    <span className={`text-xs px-2 py-1 rounded-lg font-medium ${ROLE_STYLES[member.role]}`}>{tc(`roles.${member.role}`)}</span>
                  ) : (
                    <select value={member.role} disabled={roleMut.isPending}
                      onChange={e => roleMut.mutate({ id: member.id, role: e.target.value as UserRole })}
                      className={`text-xs px-2 py-1 rounded-lg font-medium border-0 focus:outline-none focus:ring-2 focus:ring-indigo-500 ${ROLE_STYLES[member.role]}`}>
                      {ROLES.filter(r => r !== 'OWNER').map(r => <option key={r} value={r}>{tc(`roles.${r}`)}</option>)}
                    </select>
                  )}
                  <button onClick={() => { if (confirmDelete(t('removeConfirm', { name: member.name }))) removeMut.mutate(member); }}
                    disabled={isOwner || isSelf}
                    title={isOwner ? t('ownerCannotBeRemoved') : t('removeMember')}
                    className="p-1 text-gray-400 dark:text-gray-500 hover:text-red-500 disabled:opacity-30 disabled:hover:text-gray-400 dark:disabled:hover:text-gray-500 transition-colors">
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
