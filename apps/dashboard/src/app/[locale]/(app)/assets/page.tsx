'use client';
import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ImageIcon, Film, Music, Trash2, Upload, RefreshCw, Maximize2, Download, Type, Pencil } from 'lucide-react';
import { assetsApi, type Asset, type TextFontFamily, type TextSize } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { ImageLightbox } from '@/components/ImageLightbox';
import { useConfirmBeforeDelete } from '@/hooks/useConfirmBeforeDelete';
import { useAuth } from '@/context/AuthContext';
import { useAuditLog } from '@/hooks/useAuditLog';

const typeIcon: Record<string, React.ReactNode> = {
  IMAGE: <ImageIcon className="w-4 h-4 text-blue-500" />,
  VIDEO: <Film className="w-4 h-4 text-purple-500" />,
  AUDIO: <Music className="w-4 h-4 text-green-500" />,
  TEXT: <Type className="w-4 h-4 text-amber-500" />,
};

const FONT_FAMILY_STACKS: Record<TextFontFamily, string> = {
  SANS: 'system-ui, sans-serif',
  SERIF: 'Georgia, "Times New Roman", serif',
  MONOSPACE: '"Courier New", monospace',
};

const FONT_SIZE_PREVIEW: Record<TextSize, string> = {
  SMALL: '0.9rem',
  MEDIUM: '1.3rem',
  LARGE: '1.7rem',
  XLARGE: '2.1rem',
};

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 ** 2).toFixed(1)} MB`;
}

interface TextAssetModalProps {
  asset: Asset | null; // null = create mode
  onClose: () => void;
  onSaved: (asset: Asset, previousName?: string) => void;
}

function TextAssetModal({ asset, onClose, onSaved }: TextAssetModalProps) {
  const t = useTranslations('assets');
  const tc = useTranslations('common');
  const [name, setName] = useState(asset?.name ?? '');
  const [content, setContent] = useState(asset?.textContent ?? '');
  const [fontFamily, setFontFamily] = useState<TextFontFamily>(asset?.textFontFamily ?? 'SANS');
  const [color, setColor] = useState(asset?.textColor ?? '#FFFFFF');
  const [size, setSize] = useState<TextSize>(asset?.textSize ?? 'MEDIUM');

  const saveMut = useMutation({
    mutationFn: () => asset
      ? assetsApi.updateText(asset.id, { name: name.trim(), content, textFontFamily: fontFamily, textColor: color, textSize: size })
      : assetsApi.createText(name.trim(), content, { textFontFamily: fontFamily, textColor: color, textSize: size }),
    onSuccess: (saved) => onSaved(saved, asset?.name),
  });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-900 rounded-xl p-6 w-full max-w-lg shadow-xl">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
          <Type className="w-4 h-4 text-amber-500" /> {asset ? t('editTextModalTitle') : t('newTextModalTitle')}
        </h2>
        <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">{tc('name')}</label>
        <input autoFocus value={name} onChange={e => setName(e.target.value)}
          placeholder={t('newTextNamePlaceholder')}
          className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-3" />
        <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">{t('newTextContentLabel')}</label>
        <textarea value={content} onChange={e => setContent(e.target.value)} rows={4} maxLength={5000}
          placeholder={t('newTextContentPlaceholder')}
          className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-3 resize-none" />

        <div className="grid grid-cols-3 gap-2 mb-3">
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">{t('style.font')}</label>
            <select value={fontFamily} onChange={e => setFontFamily(e.target.value as TextFontFamily)}
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
              <option value="SANS">{t('style.fontSans')}</option>
              <option value="SERIF">{t('style.fontSerif')}</option>
              <option value="MONOSPACE">{t('style.fontMonospace')}</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">{t('style.size')}</label>
            <select value={size} onChange={e => setSize(e.target.value as TextSize)}
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
              <option value="SMALL">{t('style.sizeSmall')}</option>
              <option value="MEDIUM">{t('style.sizeMedium')}</option>
              <option value="LARGE">{t('style.sizeLarge')}</option>
              <option value="XLARGE">{t('style.sizeXlarge')}</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">{t('style.color')}</label>
            <div className="flex items-center gap-1 border border-gray-300 dark:border-gray-600 rounded-lg px-1.5 py-1">
              <input type="color" value={color} onChange={e => setColor(e.target.value)}
                className="w-6 h-6 shrink-0 rounded cursor-pointer bg-transparent" />
              <input value={color} onChange={e => setColor(e.target.value)} maxLength={7}
                className="w-full min-w-0 text-sm bg-transparent dark:text-gray-100 focus:outline-none" />
            </div>
          </div>
        </div>

        <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">{t('style.preview')}</label>
        <div className="w-full aspect-video bg-black rounded-lg flex items-center justify-center p-4 mb-4 overflow-hidden">
          <p style={{
            color, fontFamily: FONT_FAMILY_STACKS[fontFamily], fontSize: FONT_SIZE_PREVIEW[size],
            textAlign: 'center', whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0,
          }}>
            {content || t('newTextContentPlaceholder')}
          </p>
        </div>

        <div className="flex gap-2">
          <button onClick={onClose}
            className="flex-1 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 py-2 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-800">{tc('cancel')}</button>
          <button onClick={() => saveMut.mutate()} disabled={!name.trim() || !content.trim() || saveMut.isPending}
            className="flex-1 bg-indigo-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
            {saveMut.isPending ? t('newTextSaving') : t('newTextSave')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AssetsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { canEditContent } = usePermissions();
  const { confirmDelete } = useConfirmBeforeDelete();
  const logAction = useAuditLog();
  const t = useTranslations('assets');
  const tc = useTranslations('common');
  const ta = useTranslations('auditLog');
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadError, setUploadError] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [textModal, setTextModal] = useState<Asset | 'new' | null>(null);

  const { data: assets = [], isLoading } = useQuery({ queryKey: ['assets'], queryFn: assetsApi.list });

  function handleTextSaved(saved: Asset, previousName?: string) {
    logAction({
      resourceType: 'ASSET', resourceName: previousName ?? saved.name, action: previousName ? 'UPDATE' : 'CREATE',
      userName: user?.name ?? '', userEmail: user?.email ?? '',
    });
    void qc.invalidateQueries({ queryKey: ['assets'] });
    setTextModal(null);
  }

  const removeMut = useMutation({
    mutationFn: (asset: Asset) => assetsApi.remove(asset.id),
    onSuccess: (_data, asset) => {
      setDeleteError('');
      logAction({
        resourceType: 'ASSET', resourceName: asset.name, action: 'DELETE',
        userName: user?.name ?? '', userEmail: user?.email ?? '',
      });
      qc.setQueryData<Asset[]>(['assets'], (old) => old?.filter(a => a.id !== asset.id));
      void qc.invalidateQueries({ queryKey: ['assets'] });
    },
    onError: (e: Error) => setDeleteError(e.message),
  });

  const renameMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string; previousName: string }) => assetsApi.rename(id, name),
    onSuccess: (renamed, { previousName }) => {
      logAction({
        resourceType: 'ASSET', resourceName: previousName, action: 'UPDATE',
        userName: user?.name ?? '', userEmail: user?.email ?? '',
        detail: ta('detailRenamedTo', { name: renamed.name }),
      });
      void qc.invalidateQueries({ queryKey: ['assets'] });
      setRenamingId(null);
    },
  });

  function startRename(asset: Asset) {
    if (!canEditContent) return;
    setRenamingId(asset.id);
    setRenameValue(asset.name);
  }

  function commitRename(asset: Asset) {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === asset.name) { setRenamingId(null); return; }
    renameMut.mutate({ id: asset.id, name: trimmed, previousName: asset.name });
  }

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setUploadError('');
    try {
      for (const file of Array.from(files)) {
        const uploaded = await assetsApi.upload(file, setProgress);
        logAction({
          resourceType: 'ASSET', resourceName: uploaded.name, action: 'CREATE',
          userName: user?.name ?? '', userEmail: user?.email ?? '',
        });
      }
      void qc.invalidateQueries({ queryKey: ['assets'] });
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : t('uploadFailed'));
    } finally {
      setUploading(false);
      setProgress(0);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('subtitle')}</p>
        </div>
        {canEditContent && (
          <div className="flex items-center gap-2">
            <button onClick={() => setTextModal('new')}
              className="flex items-center gap-2 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800">
              <Type className="w-4 h-4" /> {t('newText')}
            </button>
            <button onClick={() => inputRef.current?.click()} disabled={uploading}
              className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
              {uploading ? <><RefreshCw className="w-4 h-4 animate-spin" /> {t('uploading', { progress })}</> : <><Upload className="w-4 h-4" /> {t('upload')}</>}
            </button>
            <input ref={inputRef} type="file" multiple accept="image/*,video/*,audio/*" className="hidden"
              onChange={e => { void handleFiles(e.target.files); }} />
          </div>
        )}
      </div>

      {uploadError && <div className="mb-4 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400 text-sm px-4 py-2 rounded-lg">{uploadError}</div>}
      {deleteError && <div className="mb-4 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400 text-sm px-4 py-2 rounded-lg">{deleteError}</div>}

      {textModal && canEditContent && (
        <TextAssetModal
          asset={textModal === 'new' ? null : textModal}
          onClose={() => setTextModal(null)}
          onSaved={handleTextSaved}
        />
      )}

      {isLoading && <p className="text-sm text-gray-400">{t('loading')}</p>}

      {!isLoading && assets.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <ImageIcon className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{t('empty')}</p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {assets.map((asset: Asset) => (
          <div key={asset.id} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden group">
            {/* Thumbnail — click to view full size (images) or edit (text) */}
            <button
              onClick={() => { if (asset.thumbnailUrl) setViewingId(asset.id); else if (asset.type === 'TEXT' && canEditContent) setTextModal(asset); }}
              disabled={!asset.thumbnailUrl && !(asset.type === 'TEXT' && canEditContent)}
              className="group/thumb relative w-full aspect-video bg-gray-100 dark:bg-gray-800 flex items-center justify-center disabled:cursor-default">
              {asset.thumbnailUrl ? (
                <img src={asset.thumbnailUrl} alt={asset.name} className="w-full h-full object-cover" />
              ) : asset.type === 'TEXT' ? (
                <p
                  style={{
                    color: asset.textColor ?? '#fff',
                    fontFamily: FONT_FAMILY_STACKS[asset.textFontFamily ?? 'SANS'],
                    background: '#000',
                  }}
                  className="w-full h-full px-3 py-2 text-xs overflow-hidden text-center flex items-center justify-center whitespace-pre-wrap [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:5]">
                  {asset.textContent}
                </p>
              ) : (
                <div className="text-gray-300 dark:text-gray-500">{typeIcon[asset.type]}</div>
              )}
              {asset.status === 'PROCESSING' && (
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                  <RefreshCw className="w-5 h-5 text-white animate-spin" />
                </div>
              )}
              {(asset.thumbnailUrl || (asset.type === 'TEXT' && canEditContent)) && (
                <div className="absolute inset-0 bg-black/0 group-hover/thumb:bg-black/40 flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition-all">
                  <span className="flex items-center gap-1.5 text-white text-xs font-medium">
                    {asset.thumbnailUrl ? <><Maximize2 className="w-3.5 h-3.5" /> {t('view')}</> : <><Pencil className="w-3.5 h-3.5" /> {tc('edit')}</>}
                  </span>
                </div>
              )}
            </button>
            <div className="p-3">
              <div className="flex items-start justify-between gap-1">
                <div className="min-w-0 flex-1">
                  {renamingId === asset.id ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onBlur={() => commitRename(asset)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') commitRename(asset);
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                      disabled={renameMut.isPending}
                      className="w-full text-sm font-medium text-gray-900 dark:text-gray-100 dark:bg-gray-800 border border-indigo-300 dark:border-indigo-700 rounded px-1 -mx-1 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  ) : (
                    <p
                      onClick={() => startRename(asset)}
                      title={canEditContent ? tc('clickToRename') : undefined}
                      className={`text-sm font-medium text-gray-900 dark:text-gray-100 truncate ${canEditContent ? 'cursor-text hover:text-indigo-600 dark:hover:text-indigo-400' : ''}`}>
                      {asset.name}
                    </p>
                  )}
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 flex items-center gap-1">
                    {typeIcon[asset.type]} {formatBytes(asset.sizeBytes)}
                  </p>
                </div>
                <div className="flex items-center shrink-0">
                  {asset.downloadUrl && (
                    <a href={asset.downloadUrl} title={t('download')}
                      className="p-1 text-gray-300 dark:text-gray-500 hover:text-indigo-500 transition-colors">
                      <Download className="w-3.5 h-3.5" />
                    </a>
                  )}
                  {canEditContent && (
                    <button onClick={() => { if (confirmDelete(t('deleteConfirm'))) removeMut.mutate(asset); }}
                      className="p-1 text-gray-300 dark:text-gray-500 hover:text-red-500 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {viewingId && (() => {
        const asset = assets.find(a => a.id === viewingId);
        if (!asset || !(asset.url ?? asset.thumbnailUrl)) return null;
        return (
          <ImageLightbox
            name={asset.name}
            imageUrl={asset.url ?? asset.thumbnailUrl!}
            sizeLabel={formatBytes(asset.sizeBytes)}
            typeLabel={asset.type}
            canEdit={canEditContent}
            onClose={() => setViewingId(null)}
            onRename={newName => renameMut.mutate({ id: asset.id, name: newName, previousName: asset.name })}
            downloadUrl={asset.downloadUrl}
            downloadLabel={t('download')}
            deleteLabel={t('deleteAsset')}
            onDelete={() => {
              if (confirmDelete(t('deleteConfirm'))) {
                removeMut.mutate(asset);
                setViewingId(null);
              }
            }}
          />
        );
      })()}
    </div>
  );
}
