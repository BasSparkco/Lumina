'use client';
import { use, useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ImageIcon, Film, Music, Trash2, ChevronUp, ChevronDown, Plus, ArrowLeft, RefreshCw, Send } from 'lucide-react';
import { playlistsApi, assetsApi, type Playlist, type PlaylistItem, type Asset } from '@/lib/api';
import { approvalsApi, APPROVAL_STATUS_STYLES, statusOf, type ApprovalRecord } from '@/lib/mocks/approvals';
import { useLocale, useTranslations } from 'next-intl';
import { usePermissions } from '@/hooks/usePermissions';
import { useAuth } from '@/context/AuthContext';
import { ImageLightbox } from '@/components/ImageLightbox';
import { useDefaultItemDuration } from '@/hooks/useDefaultItemDuration';
import { useAuditLog } from '@/hooks/useAuditLog';

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 ** 2).toFixed(1)} MB`;
}

export default function PlaylistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const locale = useLocale();
  const { user } = useAuth();
  const { canEditContent, canApproveContent } = usePermissions();
  const { duration: defaultDuration } = useDefaultItemDuration();
  const logAction = useAuditLog();
  const t = useTranslations('playlistDetail');
  const tc = useTranslations('common');
  const tp = useTranslations('playlists');
  const ta = useTranslations('approvals');
  const tAssets = useTranslations('assets');
  const [showAssetPicker, setShowAssetPicker] = useState(false);
  const [viewingItemId, setViewingItemId] = useState<string | null>(null);

  const { data: playlist, isLoading } = useQuery({
    queryKey: ['playlist', id],
    queryFn: () => playlistsApi.get(id),
  });

  const { data: approval, isLoading: approvalLoading } = useQuery({
    queryKey: ['approval', id],
    queryFn: () => approvalsApi.get(id),
  });
  const { data: approvalSettings = { required: true } } = useQuery({
    queryKey: ['approvalSettings'], queryFn: approvalsApi.getSettings,
  });
  const status = statusOf(approval, approvalSettings);

  // Admins/owners are the approvers, so their own submissions have no one left to review
  // them — auto-approve instead of routing to the Pending Approvals queue. Same when the org
  // has turned approvals off entirely: nothing should require manual review while that's set.
  const submitMut = useMutation({
    mutationFn: () => (canApproveContent || !approvalSettings.required)
      ? approvalsApi.approve(id, user?.name ?? user?.email ?? '')
      : approvalsApi.submit(id, user?.name ?? user?.email ?? ''),
    onSuccess: (updated) => {
      logAction({
        resourceType: 'PLAYLIST', resourceName: playlist?.name ?? '', action: canApproveContent ? 'APPROVE' : 'SUBMIT',
        userName: user?.name ?? '', userEmail: user?.email ?? '',
      });
      qc.setQueryData<ApprovalRecord>(['approval', id], updated);
      qc.setQueryData<Record<string, ApprovalRecord>>(['approvals'], (old) => ({ ...old, [id]: updated }));
      void qc.invalidateQueries({ queryKey: ['approval', id] });
      void qc.invalidateQueries({ queryKey: ['approvals'] });
    },
  });

  const { data: assets = [] } = useQuery({ queryKey: ['assets'], queryFn: assetsApi.list, enabled: showAssetPicker });

  const addMut = useMutation({
    mutationFn: ({ assetId, dur }: { assetId: string; dur: number }) =>
      playlistsApi.addItem(id, assetId, dur),
    onSuccess: (created, { assetId }) => {
      const assetName = assets.find((a: Asset) => a.id === assetId)?.name ?? '';
      logAction({
        resourceType: 'PLAYLIST', resourceName: playlist?.name ?? '', action: 'ADD_ITEM',
        userName: user?.name ?? '', userEmail: user?.email ?? '', detail: assetName,
      });
      qc.setQueryData<Playlist>(['playlist', id], (old) => old && { ...old, items: [...old.items, created] });
      void qc.invalidateQueries({ queryKey: ['playlist', id] });
      setShowAssetPicker(false);
    },
  });

  const removeMut = useMutation({
    mutationFn: (item: PlaylistItem) => playlistsApi.removeItem(id, item.id),
    onSuccess: (_data, item) => {
      logAction({
        resourceType: 'PLAYLIST', resourceName: playlist?.name ?? '', action: 'REMOVE_ITEM',
        userName: user?.name ?? '', userEmail: user?.email ?? '', detail: item.asset.name,
      });
      qc.setQueryData<Playlist>(['playlist', id], (old) => old && { ...old, items: old.items.filter(i => i.id !== item.id) });
      void qc.invalidateQueries({ queryKey: ['playlist', id] });
    },
  });

  const durMut = useMutation({
    mutationFn: ({ itemId, dur }: { itemId: string; dur: number }) => playlistsApi.updateItem(id, itemId, dur),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['playlist', id] }); },
  });

  const reorderMut = useMutation({
    mutationFn: (ids: string[]) => playlistsApi.reorder(id, ids),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['playlist', id] }); },
  });

  function move(index: number, dir: -1 | 1) {
    if (!playlist) return;
    const items = [...playlist.items];
    const target = index + dir;
    if (target < 0 || target >= items.length) return;
    [items[index], items[target]] = [items[target]!, items[index]!];
    reorderMut.mutate(items.map(i => i.id));
  }

  const typeIcon: Record<string, React.ReactNode> = {
    IMAGE: <ImageIcon className="w-3.5 h-3.5 text-blue-500" />,
    VIDEO: <Film className="w-3.5 h-3.5 text-purple-500" />,
    AUDIO: <Music className="w-3.5 h-3.5 text-green-500" />,
  };

  if (isLoading) return <div className="p-8 text-sm text-gray-400">{t('loading')}</div>;
  if (!playlist) return <div className="p-8 text-sm text-red-500">{t('notFound')}</div>;

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <Link href={`/${locale}/playlists`} className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 mb-6">
        <ArrowLeft className="w-3.5 h-3.5" /> {t('backToPlaylists')}
      </Link>

      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{playlist.name}</h1>
            {!approvalLoading && (
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${APPROVAL_STATUS_STYLES[status]}`}>
                {tc(`approvalStatus.${status}`)}
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{tp('itemCount', { count: playlist.items.length })}</p>
        </div>
        <div className="flex items-center gap-2">
          {canEditContent && !approvalLoading && (status === 'DRAFT' || status === 'REJECTED') && (
            <button onClick={() => submitMut.mutate()} disabled={submitMut.isPending}
              className="flex items-center gap-2 border border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-50 dark:hover:bg-indigo-950 disabled:opacity-50">
              <Send className="w-4 h-4" />
              {submitMut.isPending ? t('submitting') : canApproveContent ? ta('approve') : t('submitForReview')}
            </button>
          )}
          {canEditContent && (
            <button onClick={() => setShowAssetPicker(true)}
              className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">
              <Plus className="w-4 h-4" /> {t('addItem')}
            </button>
          )}
        </div>
      </div>

      {status === 'PENDING' && (
        <div className="mb-4 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
          {t('pendingReviewBanner')}
        </div>
      )}
      {status === 'REJECTED' && approval?.comment && (
        <div className="mb-4 text-xs text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg px-3 py-2">
          <span className="font-medium">{t('rejectedReasonLabel')}: </span>{approval.comment}
        </div>
      )}

      {/* Asset picker modal */}
      {showAssetPicker && canEditContent && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-900 rounded-xl p-5 w-full max-w-lg shadow-xl max-h-[70vh] flex flex-col">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">{t('pickAsset')}</h2>
            <div className="overflow-y-auto flex-1 space-y-1">
              {assets.filter((a: Asset) => a.status === 'READY').map((a: Asset) => (
                <button key={a.id} onClick={() => addMut.mutate({ assetId: a.id, dur: defaultDuration })}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-start transition-colors">
                  {a.thumbnailUrl
                    ? <img src={a.thumbnailUrl} className="w-10 h-10 rounded object-cover shrink-0" alt="" />
                    : <div className="w-10 h-10 rounded bg-gray-100 dark:bg-gray-800 flex items-center justify-center shrink-0">{typeIcon[a.type]}</div>
                  }
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{a.name}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1">{typeIcon[a.type]} {a.type}</p>
                  </div>
                  {addMut.isPending && <RefreshCw className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 animate-spin ms-auto" />}
                </button>
              ))}
              {assets.filter((a: Asset) => a.status === 'READY').length === 0 && (
                <p className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center">{t('noReadyAssets')}</p>
              )}
            </div>
            <button onClick={() => setShowAssetPicker(false)}
              className="mt-3 w-full border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 py-2 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-800">{tc('cancel')}</button>
          </div>
        </div>
      )}

      {playlist.items.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <p className="text-sm">{t('empty')}</p>
        </div>
      )}

      <div className="space-y-2">
        {playlist.items.map((item: PlaylistItem, i: number) => (
          <div key={item.id} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl flex items-center gap-3 px-3 py-2.5">
            {canEditContent && (
              <div className="flex flex-col gap-0.5">
                <button onClick={() => move(i, -1)} disabled={i === 0}
                  className="p-0.5 text-gray-300 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-20">
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => move(i, 1)} disabled={i === playlist.items.length - 1}
                  className="p-0.5 text-gray-300 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-20">
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <span className="text-xs text-gray-300 dark:text-gray-500 w-4 text-center">{i + 1}</span>

            {item.asset.thumbnailUrl ? (
              <button onClick={() => setViewingItemId(item.id)} title={t('clickToView')}
                className="w-10 h-10 rounded overflow-hidden shrink-0 hover:ring-2 hover:ring-indigo-400 transition-all">
                <img src={item.asset.thumbnailUrl} className="w-full h-full object-cover" alt="" />
              </button>
            ) : (
              <div className="w-10 h-10 rounded bg-gray-100 dark:bg-gray-800 flex items-center justify-center shrink-0">{typeIcon[item.asset.type]}</div>
            )}

            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{item.asset.name}</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1">{typeIcon[item.asset.type]} {item.asset.type}</p>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <input type="number" min={1} max={3600} value={item.durationSecs} disabled={!canEditContent}
                onChange={e => durMut.mutate({ itemId: item.id, dur: Number(e.target.value) })}
                className="w-14 border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-2 py-1 text-xs text-center focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50" />
              <span className="text-xs text-gray-400 dark:text-gray-500">{t('seconds')}</span>
            </div>

            {canEditContent && (
              <button onClick={() => removeMut.mutate(item)}
                className="p-1 text-gray-300 dark:text-gray-500 hover:text-red-500 transition-colors">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>

      {viewingItemId && (() => {
        const item = playlist.items.find(i => i.id === viewingItemId);
        const imageUrl = item?.asset.url ?? item?.asset.thumbnailUrl;
        if (!item || !imageUrl) return null;
        return (
          <ImageLightbox
            name={item.asset.name}
            imageUrl={imageUrl}
            sizeLabel={formatBytes(item.asset.sizeBytes)}
            typeLabel={item.asset.type}
            canEdit={canEditContent}
            onClose={() => setViewingItemId(null)}
            downloadUrl={item.asset.downloadUrl}
            downloadLabel={tAssets('download')}
            deleteLabel={t('removeFromPlaylist')}
            onDelete={() => {
              removeMut.mutate(item);
              setViewingItemId(null);
            }}
          />
        );
      })()}
    </div>
  );
}
