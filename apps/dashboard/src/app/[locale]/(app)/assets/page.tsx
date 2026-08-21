'use client';
import { useRef, useState } from 'react';
import Image from 'next/image';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ImageIcon, Film, Music, FileText, Trash2, Upload, RefreshCw, Maximize2, Download, Type, Pencil, Volume2, Library, CopyPlus, Search, Check, AlertTriangle, AudioLines } from 'lucide-react';
import { assetsApi, type Asset, type TextSize, type AssetCategory, type TickerDirection } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { ImageLightbox } from '@/components/ImageLightbox';
import { useConfirmBeforeDelete } from '@/hooks/useConfirmBeforeDelete';
import { useAuth } from '@/context/AuthContext';
import { useAuditLog } from '@/hooks/useAuditLog';
import { FontPicker, fontStack } from '@/components/FontPicker';
import { TickerTextPreview } from '@/components/TickerTextPreview';
import { DEFAULT_FONT_ID } from '@lumina/types';
import '@/lib/fontImports';

const typeIcon: Record<string, React.ReactNode> = {
  IMAGE: <ImageIcon className="w-4 h-4 text-blue-500" />,
  VIDEO: <Film className="w-4 h-4 text-purple-500" />,
  AUDIO: <Music className="w-4 h-4 text-green-500" />,
  TEXT: <Type className="w-4 h-4 text-amber-500" />,
  DOCUMENT: <FileText className="w-4 h-4 text-red-500" />,
};

const FONT_SIZE_PREVIEW: Record<TextSize, string> = {
  SMALL: '0.9rem',
  MEDIUM: '1.3rem',
  LARGE: '1.7rem',
  XLARGE: '2.1rem',
};

const CATEGORY_VALUES: AssetCategory[] = ['BACKGROUND', 'ICON', 'ILLUSTRATION', 'STOCK_PHOTO', 'LOGO', 'VIDEO_LOOP', 'AUDIO_JINGLE', 'GENERIC'];

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
  const [fontFamily, setFontFamily] = useState<string>(asset?.textFontFamily ?? DEFAULT_FONT_ID);
  const [color, setColor] = useState(asset?.textColor ?? '#FFFFFF');
  const [size, setSize] = useState<TextSize>(asset?.textSize ?? 'MEDIUM');
  const [backgroundColor, setBackgroundColor] = useState(asset?.textBackgroundColor ?? '#000000');
  const [tickerEnabled, setTickerEnabled] = useState(asset?.textTickerEnabled ?? false);
  const [tickerDirection, setTickerDirection] = useState<TickerDirection>(asset?.textTickerDirection ?? 'RIGHT_TO_LEFT');
  const [tickerSpeed, setTickerSpeed] = useState(asset?.textTickerSpeed ?? 80);
  const [tickerCrossPosition, setTickerCrossPosition] = useState(asset?.textTickerCrossOffset ?? 50);
  const tickerIsVertical = tickerDirection === 'TOP_TO_BOTTOM' || tickerDirection === 'BOTTOM_TO_TOP';

  const saveMut = useMutation({
    mutationFn: () => {
      const style = {
        textFontFamily: fontFamily, textColor: color, textSize: size, textBackgroundColor: backgroundColor,
        textTickerEnabled: tickerEnabled, textTickerDirection: tickerDirection, textTickerSpeed: tickerSpeed,
        textTickerCrossOffset: tickerCrossPosition,
      };
      return asset
        ? assetsApi.updateText(asset.id, { name: name.trim(), content, ...style })
        : assetsApi.createText(name.trim(), content, style);
    },
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

        <label className="flex items-center gap-2 mb-3 cursor-pointer select-none">
          <input type="checkbox" checked={tickerEnabled} onChange={e => setTickerEnabled(e.target.checked)}
            className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:ring-indigo-500" />
          <span className="text-sm text-gray-700 dark:text-gray-300">{t('style.tickerEnabled')}</span>
        </label>

        {tickerEnabled && (
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">{t('style.tickerDirection')}</label>
              <select value={tickerDirection} onChange={e => setTickerDirection(e.target.value as TickerDirection)}
                className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="RIGHT_TO_LEFT">{t('style.tickerDirectionRightToLeft')}</option>
                <option value="LEFT_TO_RIGHT">{t('style.tickerDirectionLeftToRight')}</option>
                <option value="TOP_TO_BOTTOM">{t('style.tickerDirectionTopToBottom')}</option>
                <option value="BOTTOM_TO_TOP">{t('style.tickerDirectionBottomToTop')}</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">
                {t('style.tickerSpeed')} — {tickerSpeed}px/s
              </label>
              <input type="range" min={10} max={600} step={1} value={tickerSpeed}
                onChange={e => setTickerSpeed(Number(e.target.value))}
                className="w-full accent-indigo-600" />
            </div>
          </div>
        )}

        {tickerEnabled && (
          <div className="mb-3">
            <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">
              {tickerIsVertical ? t('style.tickerHorizontalPosition') : t('style.tickerVerticalPosition')}
            </label>
            {tickerIsVertical ? (
              <input type="range" min={0} max={100} step={1} value={tickerCrossPosition}
                onChange={e => setTickerCrossPosition(Number(e.target.value))}
                className="w-full accent-indigo-600" />
            ) : (
              <div className="h-24 flex items-center justify-center">
                <input type="range" min={0} max={100} step={1} value={tickerCrossPosition}
                  onChange={e => setTickerCrossPosition(Number(e.target.value))}
                  style={{ width: '6rem', transform: 'rotate(-90deg)' }}
                  className="accent-indigo-600" />
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 mb-3">
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">{t('style.font')}</label>
            <FontPicker value={fontFamily} onChange={setFontFamily} />
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
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">{t('style.backgroundColor')}</label>
            <div className="flex items-center gap-1 border border-gray-300 dark:border-gray-600 rounded-lg px-1.5 py-1">
              <input type="color" value={backgroundColor} onChange={e => setBackgroundColor(e.target.value)}
                className="w-6 h-6 shrink-0 rounded cursor-pointer bg-transparent" />
              <input value={backgroundColor} onChange={e => setBackgroundColor(e.target.value)} maxLength={7}
                className="w-full min-w-0 text-sm bg-transparent dark:text-gray-100 focus:outline-none" />
            </div>
          </div>
        </div>

        <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">{t('style.preview')}</label>
        <div className="w-full aspect-video rounded-lg p-4 mb-4 overflow-hidden relative" style={{ background: backgroundColor }}>
          {tickerEnabled ? (
            <TickerTextPreview
              text={content || t('newTextContentPlaceholder')}
              color={color}
              fontFamily={fontStack(fontFamily)}
              fontSize={FONT_SIZE_PREVIEW[size]}
              direction={tickerDirection}
              speedPx={tickerSpeed}
              crossPosition={tickerCrossPosition}
            />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <p style={{
                color, fontFamily: fontStack(fontFamily), fontSize: FONT_SIZE_PREVIEW[size],
                textAlign: 'center', whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0,
              }}>
                {content || t('newTextContentPlaceholder')}
              </p>
            </div>
          )}
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

interface VideoUploadChoiceModalProps {
  count: number;
  onCancel: () => void;
  onChoose: (extractAudioOnly: boolean) => void;
}

// Shown when the normal upload picker's selection includes a video — lets the user decide
// whether to upload it as a video asset (the default) or extract just its audio into a new
// AUDIO asset instead, without needing a separate upload control for that choice.
function VideoUploadChoiceModal({ count, onCancel, onChoose }: VideoUploadChoiceModalProps) {
  const t = useTranslations('assets');
  const tc = useTranslations('common');

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-900 rounded-xl p-6 w-full max-w-sm shadow-xl">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">{t('videoUploadChoice.title')}</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          {count > 1 ? t('videoUploadChoice.bodyPlural', { count }) : t('videoUploadChoice.body')}
        </p>
        <div className="flex flex-col gap-2">
          <button onClick={() => onChoose(false)}
            className="w-full bg-indigo-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">
            {t('videoUploadChoice.uploadVideo')}
          </button>
          <button onClick={() => onChoose(true)}
            className="w-full flex items-center justify-center gap-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800">
            {t('videoUploadChoice.extractAudioOnly')}
          </button>
          <button onClick={onCancel}
            className="w-full text-gray-500 dark:text-gray-400 py-2 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-800">
            {tc('cancel')}
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
  const [videoUploadChoice, setVideoUploadChoice] = useState<{ videoFiles: File[]; otherFiles: File[] } | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [textModal, setTextModal] = useState<Asset | 'new' | null>(null);
  const [tab, setTab] = useState<'mine' | 'library'>('mine');
  const [libraryCategory, setLibraryCategory] = useState<AssetCategory | ''>('');
  const [librarySearch, setLibrarySearch] = useState('');
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<Asset['type'] | ''>('');
  const [usageFilter, setUsageFilter] = useState<'' | 'IN_USE' | 'UNUSED'>('');

  const { data: assets = [], isLoading } = useQuery({ queryKey: ['assets'], queryFn: assetsApi.list });

  const filteredAssets = assets.filter((a: Asset) => {
    if (search && !a.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (typeFilter && a.type !== typeFilter) return false;
    if (usageFilter === 'IN_USE' && !a.inUse) return false;
    if (usageFilter === 'UNUSED' && a.inUse) return false;
    return true;
  });

  const { data: libraryAssets = [], isLoading: libraryLoading } = useQuery({
    queryKey: ['assets', 'library', libraryCategory, librarySearch],
    queryFn: () => assetsApi.library({ category: libraryCategory || undefined, search: librarySearch || undefined }),
    enabled: tab === 'library',
  });

  const useFromLibraryMut = useMutation({
    mutationFn: (asset: Asset) => assetsApi.useFromLibrary(asset.id),
    onSuccess: (added, source) => {
      logAction({
        resourceType: 'ASSET', resourceName: added.name, action: 'CREATE',
        userName: user?.name ?? '', userEmail: user?.email ?? '',
        detail: ta('detailDuplicatedFrom', { name: source.name }),
      });
      void qc.invalidateQueries({ queryKey: ['assets'], exact: true });
      setJustAddedId(source.id);
      setTimeout(() => setJustAddedId(id => (id === source.id ? null : id)), 2000);
    },
  });

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

  const reprocessMut = useMutation({
    mutationFn: (asset: Asset) => assetsApi.reprocess(asset.id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['assets'] }),
    onError: (e: Error) => setUploadError(e.message),
  });

  const audioMut = useMutation({
    mutationFn: ({ id, audioEnabled }: { id: string; audioEnabled: boolean }) => assetsApi.setAudioEnabled(id, audioEnabled),
    onSuccess: (updated) => {
      logAction({
        resourceType: 'ASSET', resourceName: updated.name, action: 'UPDATE',
        userName: user?.name ?? '', userEmail: user?.email ?? '',
        detail: updated.audioEnabled ? t('audioEnabled') : t('audioDisabled'),
      });
      void qc.invalidateQueries({ queryKey: ['assets'] });
    },
  });

  const extractAudioMut = useMutation({
    mutationFn: (video: Asset) => assetsApi.extractAudio(video.id),
    onSuccess: (created, source) => {
      logAction({
        resourceType: 'ASSET', resourceName: created.name, action: 'CREATE',
        userName: user?.name ?? '', userEmail: user?.email ?? '',
        detail: ta('detailExtractedFrom', { name: source.name }),
      });
      void qc.invalidateQueries({ queryKey: ['assets'] });
    },
    onError: (e: Error) => setUploadError(e.message),
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

  async function runUpload(entries: { file: File; extractAudioOnly: boolean }[]) {
    if (!entries.length) return;
    setUploading(true);
    setUploadError('');
    try {
      for (const { file, extractAudioOnly } of entries) {
        const uploaded = extractAudioOnly
          ? await assetsApi.uploadAudioFromVideo(file, setProgress)
          : await assetsApi.upload(file, setProgress);
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

  // Videos get a fork here — everything else uploads immediately. Splitting the selection
  // (rather than asking file-by-file) keeps a mixed batch (e.g. a few images + one video) from
  // popping a modal per file.
  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    const fileArr = Array.from(files);
    const videoFiles = fileArr.filter(f => f.type.startsWith('video/'));
    const otherFiles = fileArr.filter(f => !f.type.startsWith('video/'));
    if (videoFiles.length > 0) {
      setVideoUploadChoice({ videoFiles, otherFiles });
      return;
    }
    await runUpload(fileArr.map(file => ({ file, extractAudioOnly: false })));
  }

  async function resolveVideoUploadChoice(extractAudioOnly: boolean) {
    if (!videoUploadChoice) return;
    const { videoFiles, otherFiles } = videoUploadChoice;
    setVideoUploadChoice(null);
    await runUpload([
      ...otherFiles.map(file => ({ file, extractAudioOnly: false })),
      ...videoFiles.map(file => ({ file, extractAudioOnly })),
    ]);
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('subtitle')}</p>
        </div>
        {tab === 'mine' && canEditContent && (
          <div className="flex items-center gap-2">
            <button onClick={() => setTextModal('new')}
              className="flex items-center gap-2 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800">
              <Type className="w-4 h-4" /> {t('newText')}
            </button>
            <button onClick={() => inputRef.current?.click()} disabled={uploading}
              className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
              {uploading ? <><RefreshCw className="w-4 h-4 animate-spin" /> {t('uploading', { progress })}</> : <><Upload className="w-4 h-4" /> {t('upload')}</>}
            </button>
            <input ref={inputRef} type="file" multiple accept="image/*,video/*,audio/*,application/pdf,.ppt,.pptx,.doc,.docx" className="hidden"
              onChange={e => { void handleFiles(e.target.files); }} />
          </div>
        )}
      </div>

      {videoUploadChoice && (
        <VideoUploadChoiceModal
          count={videoUploadChoice.videoFiles.length}
          onCancel={() => { setVideoUploadChoice(null); if (inputRef.current) inputRef.current.value = ''; }}
          onChoose={extractAudioOnly => { void resolveVideoUploadChoice(extractAudioOnly); }}
        />
      )}

      <div className="flex gap-1 mb-6 border-b border-gray-200 dark:border-gray-800">
        <button onClick={() => setTab('mine')}
          className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === 'mine' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}>
          <ImageIcon className="w-4 h-4" /> {t('myAssetsTab')}
        </button>
        <button onClick={() => setTab('library')}
          className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === 'library' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}>
          <Library className="w-4 h-4" /> {t('libraryTab')}
        </button>
      </div>

      {tab === 'mine' && (
      <>
      {uploadError && <div className="mb-4 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400 text-sm px-4 py-2 rounded-lg">{uploadError}</div>}
      {deleteError && <div className="mb-4 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400 text-sm px-4 py-2 rounded-lg">{deleteError}</div>}

      {textModal && canEditContent && (
        <TextAssetModal
          asset={textModal === 'new' ? null : textModal}
          onClose={() => setTextModal(null)}
          onSaved={handleTextSaved}
        />
      )}

      {assets.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-5">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder={tc('search')}
              className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500" />
          </div>
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value as Asset['type'] | '')}
            className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none">
            <option value="">{t('allTypes')}</option>
            <option value="IMAGE">{t('typeFilter.IMAGE')}</option>
            <option value="VIDEO">{t('typeFilter.VIDEO')}</option>
            <option value="AUDIO">{t('typeFilter.AUDIO')}</option>
            <option value="DOCUMENT">{t('typeFilter.DOCUMENT')}</option>
            <option value="TEXT">{t('typeFilter.TEXT')}</option>
          </select>
          <select value={usageFilter} onChange={e => setUsageFilter(e.target.value as '' | 'IN_USE' | 'UNUSED')}
            className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none">
            <option value="">{t('allUsage')}</option>
            <option value="IN_USE">{t('inUse')}</option>
            <option value="UNUSED">{t('unused')}</option>
          </select>
        </div>
      )}

      {isLoading && <p className="text-sm text-gray-400">{t('loading')}</p>}

      {!isLoading && assets.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <ImageIcon className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{t('empty')}</p>
        </div>
      )}

      {!isLoading && assets.length > 0 && filteredAssets.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <Search className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{tc('noMatches')}</p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {filteredAssets.map((asset: Asset) => (
          <div key={asset.id} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden group">
            {/* Thumbnail — click to view full size (images) or edit (text) */}
            <div className="group/thumb relative w-full aspect-video bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
              <button
                onClick={() => { if (asset.thumbnailUrl) setViewingId(asset.id); else if (asset.type === 'TEXT' && canEditContent) setTextModal(asset); }}
                disabled={!asset.thumbnailUrl && !(asset.type === 'TEXT' && canEditContent)}
                className="absolute inset-0 w-full h-full flex items-center justify-center disabled:cursor-default">
                {asset.thumbnailUrl ? (
                  <Image
                    src={asset.thumbnailUrl}
                    alt={asset.name}
                    fill
                    sizes="(min-width: 1024px) 25vw, (min-width: 768px) 33vw, (min-width: 640px) 50vw, 100vw"
                    className="object-cover"
                  />
                ) : asset.type === 'TEXT' ? (
                  <p
                    style={{
                      color: asset.textColor ?? '#fff',
                      fontFamily: fontStack(asset.textFontFamily),
                      background: asset.textBackgroundColor ?? '#000',
                    }}
                    className="w-full h-full px-3 py-2 text-xs overflow-hidden text-center flex items-center justify-center whitespace-pre-wrap [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:5]">
                    {asset.textContent}
                  </p>
                ) : (
                  <div className="text-gray-300 dark:text-gray-500">{typeIcon[asset.type]}</div>
                )}
                {(asset.thumbnailUrl || (asset.type === 'TEXT' && canEditContent)) && (
                  <div className="absolute inset-0 bg-black/0 group-hover/thumb:bg-black/40 flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition-all">
                    <span className="flex items-center gap-1.5 text-white text-xs font-medium">
                      {asset.thumbnailUrl ? <><Maximize2 className="w-3.5 h-3.5" /> {t('view')}</> : <><Pencil className="w-3.5 h-3.5" /> {tc('edit')}</>}
                    </span>
                  </div>
                )}
              </button>
              {asset.status === 'PROCESSING' && (
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center pointer-events-none">
                  <RefreshCw className="w-5 h-5 text-white animate-spin" />
                </div>
              )}
              {asset.status === 'ERROR' && (
                <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center gap-1.5 text-white">
                  <AlertTriangle className="w-5 h-5" />
                  <span className="text-[11px] font-medium">{t('processingFailed')}</span>
                  {canEditContent && (
                    <button
                      onClick={() => reprocessMut.mutate(asset)}
                      disabled={reprocessMut.isPending && reprocessMut.variables?.id === asset.id}
                      className="flex items-center gap-1 text-[11px] bg-white/15 hover:bg-white/25 rounded px-2 py-0.5 disabled:opacity-50">
                      <RefreshCw className={`w-3 h-3 ${reprocessMut.isPending && reprocessMut.variables?.id === asset.id ? 'animate-spin' : ''}`} /> {t('retry')}
                    </button>
                  )}
                </div>
              )}
            </div>
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
                    {asset.inUse && (
                      <span className="ms-1 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 font-medium">
                        {t('inUse')}
                      </span>
                    )}
                  </p>
                  {asset.type === 'VIDEO' && asset.status === 'READY' && asset.hasAudioTrack && (
                    <label className={`flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 mt-1 ${canEditContent ? 'cursor-pointer' : ''}`}>
                      <input type="checkbox" checked={asset.audioEnabled} disabled={!canEditContent}
                        onChange={e => audioMut.mutate({ id: asset.id, audioEnabled: e.target.checked })}
                        className="w-3.5 h-3.5 accent-indigo-500 disabled:opacity-50" />
                      <Volume2 className="w-3 h-3" /> {t('includeAudio')}
                    </label>
                  )}
                </div>
                <div className="flex items-center shrink-0">
                  {canEditContent && asset.type === 'VIDEO' && asset.status === 'READY' && asset.hasAudioTrack && (
                    <button onClick={() => extractAudioMut.mutate(asset)}
                      disabled={extractAudioMut.isPending && extractAudioMut.variables?.id === asset.id}
                      title={t('convertToAudio')}
                      className="p-1 text-gray-300 dark:text-gray-500 hover:text-indigo-500 transition-colors disabled:opacity-50">
                      <AudioLines className="w-3.5 h-3.5" />
                    </button>
                  )}
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
            {...(canEditContent && asset.type === 'VIDEO' && asset.status === 'READY' && asset.hasAudioTrack ? {
              onConvertToAudio: () => extractAudioMut.mutate(asset),
              convertToAudioLabel: t('convertToAudio'),
              convertToAudioBusy: extractAudioMut.isPending && extractAudioMut.variables?.id === asset.id,
            } : {})}
          />
        );
      })()}
      </>
      )}

      {tab === 'library' && (
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-5">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input value={librarySearch} onChange={e => setLibrarySearch(e.target.value)}
                placeholder={t('librarySearchPlaceholder')}
                className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500" />
            </div>
            <select value={libraryCategory} onChange={e => setLibraryCategory(e.target.value as AssetCategory | '')}
              className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none">
              <option value="">{t('allCategories')}</option>
              {CATEGORY_VALUES.map(c => <option key={c} value={c}>{t(`categories.${c}`)}</option>)}
            </select>
          </div>

          {libraryLoading && <p className="text-sm text-gray-400">{t('loading')}</p>}

          {!libraryLoading && libraryAssets.length === 0 && (
            <div className="text-center py-16 text-gray-400">
              <Library className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">{t('libraryEmpty')}</p>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {libraryAssets.map((asset: Asset) => (
              <div key={asset.id} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
                <div className="relative w-full aspect-video bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                  {asset.thumbnailUrl ? (
                    <Image
                    src={asset.thumbnailUrl}
                    alt={asset.name}
                    fill
                    sizes="(min-width: 1024px) 25vw, (min-width: 768px) 33vw, (min-width: 640px) 50vw, 100vw"
                    className="object-cover"
                  />
                  ) : (
                    <div className="text-gray-300 dark:text-gray-500">{typeIcon[asset.type]}</div>
                  )}
                </div>
                <div className="p-3">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{asset.name}</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 mb-2 flex items-center gap-1">
                    {typeIcon[asset.type]} {t(`categories.${asset.category}`)}
                  </p>
                  {canEditContent && (
                    <button onClick={() => useFromLibraryMut.mutate(asset)}
                      disabled={useFromLibraryMut.isPending}
                      className="w-full flex items-center justify-center gap-1.5 text-xs bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 rounded-lg py-1.5 hover:bg-indigo-100 dark:hover:bg-indigo-900 disabled:opacity-50">
                      {justAddedId === asset.id
                        ? <><Check className="w-3.5 h-3.5" /> {t('addedToMyAssets')}</>
                        : <><CopyPlus className="w-3.5 h-3.5" /> {t('addToMyAssets')}</>}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
