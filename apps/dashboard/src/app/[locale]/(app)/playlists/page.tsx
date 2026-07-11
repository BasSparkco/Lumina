'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { List, Plus, Trash2, ChevronRight, Copy, ClipboardCheck, Check, X } from 'lucide-react';
import { playlistsApi, type PlaylistSummary } from '@/lib/api';
import { approvalsApi, APPROVAL_STATUS_STYLES, statusOf, type ApprovalRecord, type ApprovalSettings } from '@/lib/mocks/approvals';
import { useLocale, useTranslations } from 'next-intl';
import { useAuth } from '@/context/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import { useConfirmBeforeDelete } from '@/hooks/useConfirmBeforeDelete';
import { useAuditLog } from '@/hooks/useAuditLog';
import { Toggle } from '@/components/Toggle';

export default function PlaylistsPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const locale = useLocale();
  const { user } = useAuth();
  const { canEditContent, canApproveContent } = usePermissions();
  const { confirmDelete } = useConfirmBeforeDelete();
  const logAction = useAuditLog();
  const t = useTranslations('playlists');
  const tc = useTranslations('common');
  const ta = useTranslations('auditLog');
  const tApp = useTranslations('approvals');
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectComment, setRejectComment] = useState('');

  const { data: playlists = [], isLoading } = useQuery({ queryKey: ['playlists'], queryFn: playlistsApi.list });
  const { data: approvals = {}, isLoading: approvalsLoading } = useQuery({ queryKey: ['approvals'], queryFn: approvalsApi.listAll });
  // Not gated behind canApproveContent — this is an org-wide setting that changes what every
  // role sees on the status badges below, not just what admins can act on.
  const { data: approvalSettings = { required: true }, isLoading: settingsLoading } = useQuery({
    queryKey: ['approvalSettings'], queryFn: approvalsApi.getSettings,
  });

  const settingsMut = useMutation({
    mutationFn: (settings: ApprovalSettings) => approvalsApi.updateSettings(settings),
    onSuccess: (settings) => qc.setQueryData(['approvalSettings'], settings),
  });

  const approveMut = useMutation({
    mutationFn: (playlist: PlaylistSummary) => approvalsApi.approve(playlist.id, user?.name ?? user?.email ?? ''),
    onSuccess: (updated, playlist) => {
      logAction({
        resourceType: 'PLAYLIST', resourceName: playlist.name, action: 'APPROVE',
        userName: user?.name ?? '', userEmail: user?.email ?? '',
      });
      qc.setQueryData<Record<string, ApprovalRecord>>(['approvals'], (old) => ({ ...old, [playlist.id]: updated }));
      void qc.invalidateQueries({ queryKey: ['approvals'] });
    },
  });

  const rejectMut = useMutation({
    mutationFn: ({ playlist, comment }: { playlist: PlaylistSummary; comment: string }) =>
      approvalsApi.reject(playlist.id, user?.name ?? user?.email ?? '', comment),
    onSuccess: (updated, { playlist, comment }) => {
      logAction({
        resourceType: 'PLAYLIST', resourceName: playlist.name, action: 'REJECT',
        userName: user?.name ?? '', userEmail: user?.email ?? '', detail: comment,
      });
      qc.setQueryData<Record<string, ApprovalRecord>>(['approvals'], (old) => ({ ...old, [playlist.id]: updated }));
      void qc.invalidateQueries({ queryKey: ['approvals'] });
      setRejectingId(null);
      setRejectComment('');
    },
  });

  const createMut = useMutation({
    mutationFn: () => playlistsApi.create(newName.trim()),
    onSuccess: (created) => {
      logAction({
        resourceType: 'PLAYLIST', resourceName: created.name, action: 'CREATE',
        userName: user?.name ?? '', userEmail: user?.email ?? '',
      });
      void qc.invalidateQueries({ queryKey: ['playlists'] });
      setNewName('');
      setCreating(false);
    },
  });

  const removeMut = useMutation({
    mutationFn: (playlist: PlaylistSummary) => playlistsApi.remove(playlist.id),
    onSuccess: (_data, playlist) => {
      setDeleteError('');
      logAction({
        resourceType: 'PLAYLIST', resourceName: playlist.name, action: 'DELETE',
        userName: user?.name ?? '', userEmail: user?.email ?? '',
      });
      qc.setQueryData<PlaylistSummary[]>(['playlists'], (old) => old?.filter(p => p.id !== playlist.id));
      void qc.invalidateQueries({ queryKey: ['playlists'] });
    },
    onError: (e: Error) => setDeleteError(e.message),
  });

  const renameMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string; previousName: string }) => playlistsApi.rename(id, name),
    onSuccess: (renamed, { previousName }) => {
      logAction({
        resourceType: 'PLAYLIST', resourceName: previousName, action: 'UPDATE',
        userName: user?.name ?? '', userEmail: user?.email ?? '',
        detail: ta('detailRenamedTo', { name: renamed.name }),
      });
      void qc.invalidateQueries({ queryKey: ['playlists'] });
      setRenamingId(null);
    },
  });

  const duplicateMut = useMutation({
    mutationFn: async (playlist: PlaylistSummary) => {
      const full = await playlistsApi.get(playlist.id);
      const created = await playlistsApi.create(`${playlist.name} (copy)`);
      for (const item of full.items) {
        await playlistsApi.addItem(created.id, item.asset.id, item.durationSecs);
      }
      return created;
    },
    onSuccess: (created, playlist) => {
      setDeleteError('');
      logAction({
        resourceType: 'PLAYLIST', resourceName: created.name, action: 'CREATE',
        userName: user?.name ?? '', userEmail: user?.email ?? '',
        detail: ta('detailDuplicatedFrom', { name: playlist.name }),
      });
      void qc.invalidateQueries({ queryKey: ['playlists'] });
    },
    onError: (e: Error) => setDeleteError(e.message),
  });

  function startRename(playlist: PlaylistSummary) {
    if (!canEditContent) return;
    setRenamingId(playlist.id);
    setRenameValue(playlist.name);
  }

  function commitRename(playlist: PlaylistSummary) {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === playlist.name) { setRenamingId(null); return; }
    renameMut.mutate({ id: playlist.id, name: trimmed, previousName: playlist.name });
  }

  const pending = canApproveContent
    ? playlists.filter((pl: PlaylistSummary) => statusOf(approvals[pl.id], approvalSettings) === 'PENDING')
    : [];

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('subtitle')}</p>
        </div>
        {canEditContent && (
          <button onClick={() => setCreating(true)}
            className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">
            <Plus className="w-4 h-4" /> {t('newPlaylist')}
          </button>
        )}
      </div>

      {canApproveContent && !settingsLoading && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 mb-4 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{tApp('requireApproval')}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">{tApp('requireApprovalDesc')}</p>
          </div>
          <Toggle checked={approvalSettings.required} onChange={v => settingsMut.mutate({ required: v })} />
        </div>
      )}

      {canApproveContent && !approvalsLoading && !settingsLoading && pending.length > 0 && (
        <div className="mb-6">
          <p className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            <ClipboardCheck className="w-4 h-4 text-amber-600" /> {tApp('pendingSectionTitle', { count: pending.length })}
          </p>
          <div className="space-y-2">
            {pending.map((pl: PlaylistSummary) => {
              const record = approvals[pl.id];
              const isRejecting = rejectingId === pl.id;
              return (
                <div key={pl.id} className="bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded-xl p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <button onClick={() => router.push(`/${locale}/playlists/${pl.id}`)}
                        className="text-sm font-medium text-gray-900 dark:text-gray-100 hover:text-indigo-600 dark:hover:text-indigo-400 text-start">
                        {pl.name}
                      </button>
                      <p className="text-xs text-gray-400 dark:text-gray-500">
                        {t('itemCount', { count: pl._count.items })}
                        {record?.submittedByName && ` · ${tApp('submittedBy', { name: record.submittedByName })}`}
                      </p>
                    </div>
                    {!isRejecting && (
                      <div className="flex items-center gap-2 shrink-0">
                        <button onClick={() => setRejectingId(pl.id)}
                          className="flex items-center gap-1 border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-red-50 dark:hover:bg-red-950/40">
                          <X className="w-3.5 h-3.5" /> {tApp('reject')}
                        </button>
                        <button onClick={() => approveMut.mutate(pl)} disabled={approveMut.isPending}
                          className="flex items-center gap-1 bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-emerald-700 disabled:opacity-50">
                          <Check className="w-3.5 h-3.5" /> {tApp('approve')}
                        </button>
                      </div>
                    )}
                  </div>

                  {isRejecting && (
                    <div className="mt-3 pt-3 border-t border-amber-200 dark:border-amber-900">
                      <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">{tApp('rejectReasonLabel')}</label>
                      <textarea autoFocus value={rejectComment} onChange={e => setRejectComment(e.target.value)}
                        placeholder={tApp('rejectReasonPlaceholder')} rows={2}
                        className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                      <div className="flex justify-end gap-2 mt-2">
                        <button onClick={() => { setRejectingId(null); setRejectComment(''); }}
                          className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">
                          {tApp('cancel')}
                        </button>
                        <button onClick={() => rejectMut.mutate({ playlist: pl, comment: rejectComment.trim() })}
                          disabled={!rejectComment.trim() || rejectMut.isPending}
                          className="px-3 py-1.5 text-xs bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50">
                          {rejectMut.isPending ? tApp('rejecting') : tApp('confirmReject')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {creating && canEditContent && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 mb-4 flex gap-2">
          <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && newName.trim()) createMut.mutate(); if (e.key === 'Escape') setCreating(false); }}
            placeholder={t('namePlaceholder')}
            className="flex-1 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          <button onClick={() => createMut.mutate()} disabled={!newName.trim() || createMut.isPending}
            className="bg-indigo-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
            {createMut.isPending ? t('creating') : tc('create')}
          </button>
          <button onClick={() => setCreating(false)}
            className="border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 px-3 py-1.5 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-800">{tc('cancel')}</button>
        </div>
      )}

      {deleteError && <div className="mb-4 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400 text-sm px-4 py-2 rounded-lg">{deleteError}</div>}

      {isLoading && <p className="text-sm text-gray-400">{t('loading')}</p>}

      {!isLoading && playlists.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <List className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{t('empty')}</p>
        </div>
      )}

      <div className="space-y-2">
        {playlists.map((pl: PlaylistSummary) => (
          <div key={pl.id}
            onClick={() => { if (renamingId !== pl.id) router.push(`/${locale}/playlists/${pl.id}`); }}
            className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl flex items-center gap-3 px-4 py-3 hover:border-indigo-200 dark:hover:border-indigo-800 transition-colors group cursor-pointer">
            <List className="w-4 h-4 text-gray-400 dark:text-gray-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                {renamingId === pl.id ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onClick={e => e.stopPropagation()}
                    onChange={e => setRenameValue(e.target.value)}
                    onBlur={() => commitRename(pl)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') commitRename(pl);
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                    disabled={renameMut.isPending}
                    className="text-sm font-medium text-gray-900 dark:text-gray-100 dark:bg-gray-800 border border-indigo-300 dark:border-indigo-700 rounded px-1 -mx-1 min-w-0 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                ) : (
                  <p
                    onClick={e => { if (canEditContent) { e.stopPropagation(); startRename(pl); } }}
                    title={canEditContent ? tc('clickToRename') : undefined}
                    className={`text-sm font-medium text-gray-900 dark:text-gray-100 ${canEditContent ? 'cursor-text hover:text-indigo-600 dark:hover:text-indigo-400' : ''}`}>
                    {pl.name}
                  </p>
                )}
                {!approvalsLoading && !settingsLoading && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${APPROVAL_STATUS_STYLES[statusOf(approvals[pl.id], approvalSettings)]}`}>
                    {tc(`approvalStatus.${statusOf(approvals[pl.id], approvalSettings)}`)}
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500">{t('itemCount', { count: pl._count.items })}</p>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-500 group-hover:text-indigo-400 transition-colors" />
            {canEditContent && (
              <button onClick={e => { e.stopPropagation(); duplicateMut.mutate(pl); }} disabled={duplicateMut.isPending}
                title={t('duplicate')} className="p-1 text-gray-300 dark:text-gray-500 hover:text-indigo-600 transition-colors disabled:opacity-50">
                <Copy className="w-3.5 h-3.5" />
              </button>
            )}
            {canEditContent && (
              <button onClick={e => { e.stopPropagation(); if (confirmDelete(t('deleteConfirm'))) removeMut.mutate(pl); }}
                className="p-1 text-gray-300 dark:text-gray-500 hover:text-red-500 transition-colors">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
