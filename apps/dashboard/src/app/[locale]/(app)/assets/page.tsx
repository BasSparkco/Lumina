'use client';
import { Suspense, useEffect, useMemo } from 'react';
import { useRef, useState } from 'react';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations, useLocale } from 'next-intl';
import { ImageIcon, Film, Music, FileText, Trash2, Upload, RefreshCw, Maximize2, Download, Type, Pencil, Volume2, Library, CopyPlus, Search, Check, AlertTriangle, AudioLines, Plus, LayoutTemplate, Palette, MapPin, LayoutGrid, SquarePlay, ExternalLink, ListVideo, ArrowLeft, Shuffle, ListOrdered } from 'lucide-react';
import { assetsApi, appsApi, designsApi, type Asset, type DesignAsset, type TextSize, type AssetCategory, type TickerDirection, type AppProvider, type ResolvedApp, type AppPlaybackOrder } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { ImageLightbox } from '@/components/ImageLightbox';
import { ContextMenu, type ContextMenuState, type ContextMenuAction } from '@/components/ContextMenu';
import { useConfirmBeforeDelete } from '@/hooks/useConfirmBeforeDelete';
import { FontPicker, fontStack } from '@/components/FontPicker';
import { TickerTextPreview } from '@/components/TickerTextPreview';
import { DesignPreview } from '@/components/DesignPreview';
import { DEFAULT_FONT_ID } from '@lumina/types';
import '@/lib/fontImports';

const typeIcon: Record<string, React.ReactNode> = {
  IMAGE: <ImageIcon className="w-4 h-4 text-blue-500" />,
  VIDEO: <Film className="w-4 h-4 text-purple-500" />,
  AUDIO: <Music className="w-4 h-4 text-green-500" />,
  TEXT: <Type className="w-4 h-4 text-amber-500" />,
  DOCUMENT: <FileText className="w-4 h-4 text-red-500" />,
  APP: <SquarePlay className="w-4 h-4 text-red-600" />,
};

// Per-provider icon for APP assets/tiles — every new provider added to the backend registry
// (apps/api/src/modules/apps/providers.ts) gets one entry here; falls back to a generic icon
// for any provider not yet given one.
const PROVIDER_ICON: Record<string, React.ReactNode> = {
  youtube: <SquarePlay className="w-4 h-4 text-red-600" />,
};
function assetIcon(asset: Asset) {
  return asset.type === 'APP' ? (PROVIDER_ICON[asset.appProviderId ?? ''] ?? typeIcon.APP) : typeIcon[asset.type];
}

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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      {/* max-h + overflow-y-auto — with ticker options expanded this panel can be taller than
          the viewport (especially on shorter screens), and without a scroll boundary here the
          Save/Cancel row at the bottom becomes unreachable. */}
      <div className="glass-popup rounded-2xl p-6 w-full max-w-lg shadow-xl max-h-[90vh] overflow-y-auto">
        <h2 className="font-semibold text-[var(--deck-text-hi)] mb-4 flex items-center gap-2">
          <Type className="w-4 h-4 text-amber-500" /> {asset ? t('editTextModalTitle') : t('newTextModalTitle')}
        </h2>
        <label className="text-xs text-[var(--deck-text-mid)] block mb-1">{tc('name')}</label>
        <input autoFocus value={name} onChange={e => setName(e.target.value)}
          placeholder={t('newTextNamePlaceholder')}
          className="w-full border border-[var(--deck-glass-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--deck-accent)] mb-3" />
        <label className="text-xs text-[var(--deck-text-mid)] block mb-1">{t('newTextContentLabel')}</label>
        <textarea value={content} onChange={e => setContent(e.target.value)} rows={4} maxLength={5000}
          placeholder={t('newTextContentPlaceholder')}
          className="w-full border border-[var(--deck-glass-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--deck-accent)] mb-3 resize-none" />

        <label className="flex items-center gap-2 mb-3 cursor-pointer select-none">
          <input type="checkbox" checked={tickerEnabled} onChange={e => setTickerEnabled(e.target.checked)}
            className="w-4 h-4 rounded border-[var(--deck-glass-border)] text-[var(--deck-accent)] focus:ring-[var(--deck-accent)]" />
          <span className="text-sm text-[var(--deck-text-hi)]">{t('style.tickerEnabled')}</span>
        </label>

        {tickerEnabled && (
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div>
              <label className="text-xs text-[var(--deck-text-mid)] block mb-1">{t('style.tickerDirection')}</label>
              <select value={tickerDirection} onChange={e => setTickerDirection(e.target.value as TickerDirection)}
                className="w-full border border-[var(--deck-glass-border)] rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--deck-accent)]">
                <option value="RIGHT_TO_LEFT">{t('style.tickerDirectionRightToLeft')}</option>
                <option value="LEFT_TO_RIGHT">{t('style.tickerDirectionLeftToRight')}</option>
                <option value="TOP_TO_BOTTOM">{t('style.tickerDirectionTopToBottom')}</option>
                <option value="BOTTOM_TO_TOP">{t('style.tickerDirectionBottomToTop')}</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-[var(--deck-text-mid)] block mb-1">
                {t('style.tickerSpeed')} — {tickerSpeed}px/s
              </label>
              <input type="range" min={10} max={600} step={1} value={tickerSpeed}
                onChange={e => setTickerSpeed(Number(e.target.value))}
                className="w-full accent-[var(--deck-accent)]" />
            </div>
          </div>
        )}

        {tickerEnabled && (
          <div className="mb-3">
            <label className="text-xs text-[var(--deck-text-mid)] block mb-1">
              {tickerIsVertical ? t('style.tickerHorizontalPosition') : t('style.tickerVerticalPosition')}
            </label>
            {tickerIsVertical ? (
              <input type="range" min={0} max={100} step={1} value={tickerCrossPosition}
                onChange={e => setTickerCrossPosition(Number(e.target.value))}
                className="w-full accent-[var(--deck-accent)]" />
            ) : (
              <div className="h-24 flex items-center justify-center">
                <input type="range" min={0} max={100} step={1} value={tickerCrossPosition}
                  onChange={e => setTickerCrossPosition(Number(e.target.value))}
                  style={{ width: '6rem', transform: 'rotate(-90deg)' }}
                  className="accent-[var(--deck-accent)]" />
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 mb-3">
          <div>
            <label className="text-xs text-[var(--deck-text-mid)] block mb-1">{t('style.font')}</label>
            <FontPicker value={fontFamily} onChange={setFontFamily} />
          </div>
          <div>
            <label className="text-xs text-[var(--deck-text-mid)] block mb-1">{t('style.size')}</label>
            <select value={size} onChange={e => setSize(e.target.value as TextSize)}
              className="w-full border border-[var(--deck-glass-border)] rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--deck-accent)]">
              <option value="SMALL">{t('style.sizeSmall')}</option>
              <option value="MEDIUM">{t('style.sizeMedium')}</option>
              <option value="LARGE">{t('style.sizeLarge')}</option>
              <option value="XLARGE">{t('style.sizeXlarge')}</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-[var(--deck-text-mid)] block mb-1">{t('style.color')}</label>
            <div className="flex items-center gap-1 border border-[var(--deck-glass-border)] rounded-lg px-1.5 py-1">
              <input type="color" value={color} onChange={e => setColor(e.target.value)}
                className="w-6 h-6 shrink-0 rounded cursor-pointer bg-transparent" />
              <input value={color} onChange={e => setColor(e.target.value)} maxLength={7}
                className="w-full min-w-0 text-sm bg-transparent focus:outline-none" />
            </div>
          </div>
          <div>
            <label className="text-xs text-[var(--deck-text-mid)] block mb-1">{t('style.backgroundColor')}</label>
            <div className="flex items-center gap-1 border border-[var(--deck-glass-border)] rounded-lg px-1.5 py-1">
              <input type="color" value={backgroundColor} onChange={e => setBackgroundColor(e.target.value)}
                className="w-6 h-6 shrink-0 rounded cursor-pointer bg-transparent" />
              <input value={backgroundColor} onChange={e => setBackgroundColor(e.target.value)} maxLength={7}
                className="w-full min-w-0 text-sm bg-transparent focus:outline-none" />
            </div>
          </div>
        </div>

        <label className="text-xs text-[var(--deck-text-mid)] block mb-1">{t('style.preview')}</label>
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
            className="flex-1 border border-[var(--deck-glass-border)] text-[var(--deck-text-hi)] py-2 rounded-lg text-sm hover:bg-[var(--deck-glass-fill-strong)]">{tc('cancel')}</button>
          <button onClick={() => saveMut.mutate()} disabled={!name.trim() || !content.trim() || saveMut.isPending}
            className="flex-1 bg-[var(--deck-accent)] text-white py-2 rounded-lg text-sm font-medium  disabled:opacity-50">
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
      <div className="glass-popup rounded-2xl p-6 w-full max-w-sm shadow-xl">
        <h2 className="font-semibold text-[var(--deck-text-hi)] mb-2">{t('videoUploadChoice.title')}</h2>
        <p className="text-sm text-[var(--deck-text-mid)] mb-4">
          {count > 1 ? t('videoUploadChoice.bodyPlural', { count }) : t('videoUploadChoice.body')}
        </p>
        <div className="flex flex-col gap-2">
          <button onClick={() => onChoose(false)}
            className="w-full bg-[var(--deck-accent)] text-white py-2 rounded-lg text-sm font-medium ">
            {t('videoUploadChoice.uploadVideo')}
          </button>
          <button onClick={() => onChoose(true)}
            className="w-full flex items-center justify-center gap-2 border border-[var(--deck-glass-border)] text-[var(--deck-text-hi)] py-2 rounded-lg text-sm font-medium hover:bg-[var(--deck-glass-fill-strong)]">
            {t('videoUploadChoice.extractAudioOnly')}
          </button>
          <button onClick={onCancel}
            className="w-full text-[var(--deck-text-mid)] py-2 rounded-lg text-sm hover:bg-[var(--deck-glass-fill-strong)]">
            {tc('cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}

interface PasteConfirmModalProps {
  file: File;
  onCancel: () => void;
  onConfirm: () => void;
}

// Shown when an image is pasted from the clipboard anywhere on the Assets page — a mid-air
// paste can easily be accidental (e.g. a stray Ctrl+V while switching windows), so this shows
// what's about to be uploaded and requires an explicit confirm before it becomes a new asset.
function PasteConfirmModal({ file, onCancel, onConfirm }: PasteConfirmModalProps) {
  const t = useTranslations('assets');
  const tc = useTranslations('common');
  const previewUrl = useMemo(() => URL.createObjectURL(file), [file]);

  useEffect(() => () => URL.revokeObjectURL(previewUrl), [previewUrl]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="glass-popup rounded-2xl p-6 w-full max-w-sm shadow-xl">
        <h2 className="font-semibold text-[var(--deck-text-hi)] mb-2">{t('pasteConfirm.title')}</h2>
        <p className="text-sm text-[var(--deck-text-mid)] mb-4">{t('pasteConfirm.body')}</p>
        <div className="mb-4 rounded-lg overflow-hidden border border-[var(--deck-glass-border)] bg-[var(--deck-glass-fill-strong)]">
          {/* eslint-disable-next-line @next/next/no-img-element -- transient blob: URL, not a next/image-eligible remote asset */}
          <img src={previewUrl} alt={file.name} className="w-full max-h-64 object-contain" />
        </div>
        <div className="flex flex-col gap-2">
          <button onClick={onConfirm}
            className="w-full bg-[var(--deck-accent)] text-white py-2 rounded-lg text-sm font-medium ">
            {t('pasteConfirm.confirm')}
          </button>
          <button onClick={onCancel}
            className="w-full text-[var(--deck-text-mid)] py-2 rounded-lg text-sm hover:bg-[var(--deck-glass-fill-strong)]">
            {tc('cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}

interface AppAssetModalProps {
  provider: AppProvider;
  onClose: () => void;
  onCreated: (asset: Asset) => void;
}

// Paste-a-URL → preview → confirm flow for adding an "app" asset (currently just YouTube).
// Resolving is a separate step from creating so the user sees the title/thumbnail before
// committing; the create call re-resolves server-side rather than trusting this preview.
function AppAssetModal({ provider, onClose, onCreated }: AppAssetModalProps) {
  const t = useTranslations('assets');
  const tc = useTranslations('common');
  const [url, setUrl] = useState('');
  const [preview, setPreview] = useState<ResolvedApp | null>(null);

  const resolveMut = useMutation({
    mutationFn: (u: string) => appsApi.resolve(provider.id, u),
    onSuccess: setPreview,
  });

  const createMut = useMutation({
    mutationFn: () => assetsApi.createApp(provider.id, url.trim()),
    onSuccess: onCreated,
  });

  function handleBlur() {
    const trimmed = url.trim();
    if (trimmed && trimmed !== preview?.sourceUrl) resolveMut.mutate(trimmed);
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="glass-popup rounded-2xl p-6 w-full max-w-lg shadow-xl">
        <h2 className="font-semibold text-[var(--deck-text-hi)] mb-4 flex items-center gap-2">
          {PROVIDER_ICON[provider.id] ?? <LayoutGrid className="w-4 h-4" />} {t('apps.addModalTitle', { provider: provider.name })}
        </h2>
        <label className="text-xs text-[var(--deck-text-mid)] block mb-1">{t('apps.urlLabel')}</label>
        <input autoFocus value={url}
          onChange={e => { setUrl(e.target.value); setPreview(null); resolveMut.reset(); }}
          onBlur={handleBlur}
          placeholder={t('apps.urlPlaceholder')}
          className="w-full border border-[var(--deck-glass-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--deck-accent)] mb-3" />

        {resolveMut.isPending && <p className="text-xs text-[var(--deck-text-low)] mb-3">{t('apps.checking')}</p>}
        {resolveMut.isError && <p className="text-xs text-red-500 mb-3">{(resolveMut.error as Error).message}</p>}
        {preview && (
          <div className="flex items-center gap-3 mb-4 border border-[var(--deck-glass-border)] rounded-lg p-2">
            {preview.thumbnailUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- external oEmbed thumbnail, not in next/image's remotePatterns allowlist
              <img src={preview.thumbnailUrl} alt="" className="w-24 aspect-video object-cover rounded shrink-0" />
            )}
            <p className="text-sm text-[var(--deck-text-hi)] line-clamp-2">{preview.title}</p>
          </div>
        )}
        {createMut.isError && <p className="text-xs text-red-500 mb-3">{(createMut.error as Error).message}</p>}

        <div className="flex gap-2">
          <button onClick={onClose}
            className="flex-1 border border-[var(--deck-glass-border)] text-[var(--deck-text-hi)] py-2 rounded-lg text-sm hover:bg-[var(--deck-glass-fill-strong)]">{tc('cancel')}</button>
          <button onClick={() => createMut.mutate()} disabled={!preview || createMut.isPending}
            className="flex-1 bg-[var(--deck-accent)] text-white py-2 rounded-lg text-sm font-medium  disabled:opacity-50">
            {createMut.isPending ? t('apps.adding') : t('apps.add')}
          </button>
        </div>
      </div>
    </div>
  );
}

interface AppPlaylistModalProps {
  provider: AppProvider;
  onClose: () => void;
  onCreated: (asset: Asset) => void;
}

// Builds a curated, ordered list of videos from one provider — paste a URL, it resolves and
// appends to the list, repeat; choose Sequential or Shuffle; save. Re-resolves every item
// server-side on save, same principle as AppAssetModal above.
function AppPlaylistModal({ provider, onClose, onCreated }: AppPlaylistModalProps) {
  const t = useTranslations('assets');
  const tc = useTranslations('common');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [items, setItems] = useState<ResolvedApp[]>([]);
  const [playbackOrder, setPlaybackOrder] = useState<AppPlaybackOrder>('SEQUENTIAL');

  const resolveMut = useMutation({
    mutationFn: (u: string) => appsApi.resolve(provider.id, u),
    onSuccess: (resolved) => {
      setItems(prev => [...prev, resolved]);
      setUrl('');
    },
  });

  const createMut = useMutation({
    mutationFn: () => assetsApi.createAppPlaylist(provider.id, name.trim(), playbackOrder, items.map(i => i.sourceUrl)),
    onSuccess: onCreated,
  });

  function handleAddItem() {
    const trimmed = url.trim();
    if (trimmed) resolveMut.mutate(trimmed);
  }

  function removeItem(index: number) {
    setItems(prev => prev.filter((_, i) => i !== index));
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="glass-popup rounded-2xl p-6 w-full max-w-lg shadow-xl max-h-[85vh] overflow-y-auto">
        <h2 className="font-semibold text-[var(--deck-text-hi)] mb-4 flex items-center gap-2">
          <ListVideo className="w-4 h-4 text-red-600" /> {t('apps.createPlaylistTitle', { provider: provider.name })}
        </h2>

        <label className="text-xs text-[var(--deck-text-mid)] block mb-1">{tc('name')}</label>
        <input autoFocus value={name} onChange={e => setName(e.target.value)}
          placeholder={t('apps.playlistNamePlaceholder')}
          className="w-full border border-[var(--deck-glass-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--deck-accent)] mb-3" />

        <label className="text-xs text-[var(--deck-text-mid)] block mb-1">{t('apps.playbackOrderLabel')}</label>
        <div className="flex gap-2 mb-3">
          <button type="button" onClick={() => setPlaybackOrder('SEQUENTIAL')}
            className={`flex-1 flex items-center justify-center gap-1.5 text-xs py-1.5 rounded-lg border font-medium ${
              playbackOrder === 'SEQUENTIAL' ? 'bg-[var(--deck-accent)] border-[var(--deck-accent)] text-white' : 'border-[var(--deck-glass-border)] text-[var(--deck-text-mid)] hover:bg-[var(--deck-glass-fill-strong)]'
            }`}>
            <ListOrdered className="w-3.5 h-3.5" /> {t('apps.sequential')}
          </button>
          <button type="button" onClick={() => setPlaybackOrder('SHUFFLE')}
            className={`flex-1 flex items-center justify-center gap-1.5 text-xs py-1.5 rounded-lg border font-medium ${
              playbackOrder === 'SHUFFLE' ? 'bg-[var(--deck-accent)] border-[var(--deck-accent)] text-white' : 'border-[var(--deck-glass-border)] text-[var(--deck-text-mid)] hover:bg-[var(--deck-glass-fill-strong)]'
            }`}>
            <Shuffle className="w-3.5 h-3.5" /> {t('apps.shuffle')}
          </button>
        </div>

        <label className="text-xs text-[var(--deck-text-mid)] block mb-1">{t('apps.urlLabel')}</label>
        <div className="flex gap-2 mb-1">
          <input value={url}
            onChange={e => { setUrl(e.target.value); resolveMut.reset(); }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddItem(); } }}
            placeholder={t('apps.urlPlaceholder')}
            className="flex-1 min-w-0 border border-[var(--deck-glass-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--deck-accent)]" />
          <button type="button" onClick={handleAddItem} disabled={!url.trim() || resolveMut.isPending}
            className="shrink-0 bg-[var(--deck-glass-fill-strong)] text-[var(--deck-text-hi)] px-3 py-2 rounded-lg text-sm font-medium hover:bg-[var(--deck-glass-fill-strong)] disabled:opacity-50">
            {resolveMut.isPending ? t('apps.checking') : t('apps.addItem')}
          </button>
        </div>
        {resolveMut.isError && <p className="text-xs text-red-500 mb-3">{(resolveMut.error as Error).message}</p>}

        {items.length > 0 && (
          <ul className="mt-3 mb-4 border border-[var(--deck-glass-border)] rounded-lg divide-y divide-[var(--deck-glass-border-soft)] max-h-56 overflow-y-auto">
            {items.map((item, i) => (
              <li key={`${item.sourceUrl}-${i}`} className="flex items-center gap-2 p-2">
                {item.thumbnailUrl && (
                  // eslint-disable-next-line @next/next/no-img-element -- external oEmbed thumbnail
                  <img src={item.thumbnailUrl} alt="" className="w-14 aspect-video object-cover rounded shrink-0" />
                )}
                <span className="flex-1 min-w-0 text-sm text-[var(--deck-text-hi)] truncate">{item.title}</span>
                <button type="button" onClick={() => removeItem(i)}
                  className="p-1 text-[var(--deck-text-low)] hover:text-red-500 transition-colors">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {createMut.isError && <p className="text-xs text-red-500 mb-3">{(createMut.error as Error).message}</p>}

        <div className="flex gap-2">
          <button onClick={onClose}
            className="flex-1 border border-[var(--deck-glass-border)] text-[var(--deck-text-hi)] py-2 rounded-lg text-sm hover:bg-[var(--deck-glass-fill-strong)]">{tc('cancel')}</button>
          <button onClick={() => createMut.mutate()} disabled={!name.trim() || items.length === 0 || createMut.isPending}
            className="flex-1 bg-[var(--deck-accent)] text-white py-2 rounded-lg text-sm font-medium  disabled:opacity-50">
            {createMut.isPending ? t('apps.adding') : t('apps.createPlaylistSave')}
          </button>
        </div>
      </div>
    </div>
  );
}

interface LibraryUploadModalProps {
  onClose: () => void;
  onUploaded: (asset: Asset) => void;
}

// Super-Admin-only (usePermissions().canManageLibrary): adds a new stock asset to the shared
// library (organizationId: null). Collects category/tags up front — unlike the "mine" tab's plain
// upload, there's no per-org context to default them from, so the producer chooses them here instead.
function LibraryUploadModal({ onClose, onUploaded }: LibraryUploadModalProps) {
  const t = useTranslations('assets');
  const tc = useTranslations('common');
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState<AssetCategory>('GENERIC');
  const [tagsText, setTagsText] = useState('');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');

  const uploadMut = useMutation({
    mutationFn: () => {
      const tags = tagsText.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      return assetsApi.uploadToLibrary(file!, category, tags, setProgress);
    },
    onSuccess: onUploaded,
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="glass-popup rounded-2xl p-6 w-full max-w-sm shadow-xl">
        <h2 className="font-semibold text-[var(--deck-text-hi)] mb-4">{t('libraryUpload')}</h2>

        <label className="text-xs text-[var(--deck-text-mid)] block mb-1">{t('libraryUploadFile')}</label>
        <input type="file" accept="image/*,video/*,audio/*,application/pdf,.ppt,.pptx,.doc,.docx"
          onChange={e => setFile(e.target.files?.[0] ?? null)}
          className="w-full text-sm text-[var(--deck-text-hi)] mb-3" />

        <label className="text-xs text-[var(--deck-text-mid)] block mb-1">{t('categoryLabel')}</label>
        <select value={category} onChange={e => setCategory(e.target.value as AssetCategory)}
          className="w-full border border-[var(--deck-glass-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--deck-accent)] mb-3">
          {CATEGORY_VALUES.map(c => <option key={c} value={c}>{t(`categories.${c}`)}</option>)}
        </select>

        <label className="text-xs text-[var(--deck-text-mid)] block mb-1">{t('libraryTags')}</label>
        <input value={tagsText} onChange={e => setTagsText(e.target.value)}
          placeholder={t('libraryTagsPlaceholder')}
          className="w-full border border-[var(--deck-glass-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--deck-accent)] mb-2" />

        {uploadMut.isPending && <p className="text-xs text-[var(--deck-text-mid)] mb-2">{t('uploading', { progress })}</p>}
        {error && <p className="text-xs text-red-600 mb-2">{error}</p>}

        <div className="flex gap-2 mt-3">
          <button onClick={onClose}
            className="flex-1 border border-[var(--deck-glass-border)] text-[var(--deck-text-hi)] py-2 rounded-lg text-sm hover:bg-[var(--deck-glass-fill-strong)]">{tc('cancel')}</button>
          <button onClick={() => uploadMut.mutate()} disabled={!file || uploadMut.isPending}
            className="flex-1 bg-[var(--deck-accent)] text-white py-2 rounded-lg text-sm font-medium  disabled:opacity-50">
            {uploadMut.isPending ? t('uploading', { progress }) : t('libraryUpload')}
          </button>
        </div>
      </div>
    </div>
  );
}

function AssetsPageInner() {
  const qc = useQueryClient();
  const { canEditContent, canManageLibrary } = usePermissions();
  const { confirmDelete } = useConfirmBeforeDelete();
  const t = useTranslations('assets');
  const tc = useTranslations('common');
  const router = useRouter();
  const locale = useLocale();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadError, setUploadError] = useState('');
  const [newMenu, setNewMenu] = useState<ContextMenuState | null>(null);
  const [videoUploadChoice, setVideoUploadChoice] = useState<{ videoFiles: File[]; otherFiles: File[] } | null>(null);
  const [pasteConfirm, setPasteConfirm] = useState<File | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [textModal, setTextModal] = useState<Asset | 'new' | null>(null);
  const [appModalProvider, setAppModalProvider] = useState<AppProvider | null>(null);
  const [appPlaylistModalProvider, setAppPlaylistModalProvider] = useState<AppProvider | null>(null);
  const [providerMenu, setProviderMenu] = useState<ContextMenuState | null>(null);
  const searchParams = useSearchParams();
  // designer2's Save flow links here as `/assets?tab=designs` after saving a design. Read once as
  // the initial state (not synced via an effect) — the component using useSearchParams is already
  // wrapped in Suspense (see the default export below), which is what makes it safe to derive this
  // during the initial render instead of risking a server/client hydration mismatch.
  const [tab, setTab] = useState<'mine' | 'apps' | 'library' | 'designs'>(
    searchParams.get('tab') === 'designs' ? 'designs' : 'mine',
  );
  // Apps tab: 'gallery' (default) shows what you've already created; 'create' shows the
  // provider grid to start a new one, behind the top-right Create button.
  const [appsView, setAppsView] = useState<'gallery' | 'create'>('gallery');
  const [libraryCategory, setLibraryCategory] = useState<AssetCategory | ''>('');
  const [librarySearch, setLibrarySearch] = useState('');
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  const [showLibraryUpload, setShowLibraryUpload] = useState(false);
  const [libraryRenamingId, setLibraryRenamingId] = useState<string | null>(null);
  const [libraryRenameValue, setLibraryRenameValue] = useState('');
  const [libraryDeleteError, setLibraryDeleteError] = useState('');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<Asset['type'] | ''>('');
  const [usageFilter, setUsageFilter] = useState<'' | 'IN_USE' | 'UNUSED'>('');

  const { data: assets = [], isLoading } = useQuery({ queryKey: ['assets'], queryFn: assetsApi.list });
  const { data: designs = [], isLoading: designsLoading } = useQuery({
    queryKey: ['designs'],
    queryFn: designsApi.list,
    enabled: tab === 'designs',
  });
  const [renamingDesignId, setRenamingDesignId] = useState<string | null>(null);
  const [designRenameValue, setDesignRenameValue] = useState('');

  const assetUrlById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const a of assets as Asset[]) {
      const url = a.url ?? a.thumbnailUrl;
      if (url) map[a.id] = url;
    }
    return map;
  }, [assets]);

  // APP assets live on the Apps tab, not here (see appsroadmap.md Phase 7) — My Assets only
  // ever shows the rest.
  const nonAppAssets = assets.filter((a: Asset) => a.type !== 'APP');
  const appAssets = assets.filter((a: Asset) => a.type === 'APP');

  const filteredAssets = nonAppAssets.filter((a: Asset) => {
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

  const { data: appProviders = [] } = useQuery({
    queryKey: ['apps', 'providers'],
    queryFn: appsApi.providers,
    enabled: tab === 'apps',
  });

  function handleAppCreated(_asset: Asset) {
    void qc.invalidateQueries({ queryKey: ['assets'] });
    setAppModalProvider(null);
    setAppPlaylistModalProvider(null);
    setAppsView('gallery');
  }

  const useFromLibraryMut = useMutation({
    mutationFn: (asset: Asset) => assetsApi.useFromLibrary(asset.id),
    onSuccess: (_added, source) => {
      void qc.invalidateQueries({ queryKey: ['assets'], exact: true });
      setJustAddedId(source.id);
      setTimeout(() => setJustAddedId(id => (id === source.id ? null : id)), 2000);
    },
  });

  function handleLibraryUploaded(_asset: Asset) {
    void qc.invalidateQueries({ queryKey: ['assets', 'library'] });
    setShowLibraryUpload(false);
  }

  const updateLibraryMut = useMutation({
    mutationFn: ({ id, ...dto }: { id: string; name?: string; category?: AssetCategory; tags?: string[] }) =>
      assetsApi.updateLibraryAsset(id, dto),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['assets', 'library'] });
      setLibraryRenamingId(null);
    },
  });

  const removeLibraryMut = useMutation({
    mutationFn: (asset: Asset) => assetsApi.removeFromLibrary(asset.id),
    onSuccess: () => {
      setLibraryDeleteError('');
      void qc.invalidateQueries({ queryKey: ['assets', 'library'] });
    },
    onError: (e: Error) => setLibraryDeleteError(e.message),
  });

  function startLibraryRename(asset: Asset) {
    if (!canManageLibrary) return;
    setLibraryRenamingId(asset.id);
    setLibraryRenameValue(asset.name);
  }

  function commitLibraryRename(asset: Asset) {
    const trimmed = libraryRenameValue.trim();
    if (!trimmed || trimmed === asset.name) { setLibraryRenamingId(null); return; }
    updateLibraryMut.mutate({ id: asset.id, name: trimmed });
  }

  function commitLibraryTags(asset: Asset, raw: string) {
    const tags = raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (tags.join(',') === asset.tags.join(',')) return;
    updateLibraryMut.mutate({ id: asset.id, tags });
  }

  function handleTextSaved(_saved: Asset, _previousName?: string) {
    void qc.invalidateQueries({ queryKey: ['assets'] });
    setTextModal(null);
  }

  const removeMut = useMutation({
    mutationFn: (asset: Asset) => assetsApi.remove(asset.id),
    onSuccess: (_data, asset) => {
      setDeleteError('');
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
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['assets'] });
    },
  });

  const extractAudioMut = useMutation({
    mutationFn: (video: Asset) => assetsApi.extractAudio(video.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['assets'] });
    },
    onError: (e: Error) => setUploadError(e.message),
  });

  const renameMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string; previousName: string }) => assetsApi.rename(id, name),
    onSuccess: () => {
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

  const renameDesignMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string; previousName: string }) => designsApi.rename(id, name),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['designs'] });
      setRenamingDesignId(null);
    },
  });

  function startRenameDesign(design: DesignAsset) {
    if (!canEditContent) return;
    setRenamingDesignId(design.id);
    setDesignRenameValue(design.name);
  }

  function commitRenameDesign(design: DesignAsset) {
    const trimmed = designRenameValue.trim();
    if (!trimmed || trimmed === design.name) { setRenamingDesignId(null); return; }
    renameDesignMut.mutate({ id: design.id, name: trimmed, previousName: design.name });
  }

  async function runUpload(entries: { file: File; extractAudioOnly: boolean }[]) {
    if (!entries.length) return;
    setUploading(true);
    setUploadError('');
    try {
      for (const { file, extractAudioOnly } of entries) {
        extractAudioOnly
          ? await assetsApi.uploadAudioFromVideo(file, setProgress)
          : await assetsApi.upload(file, setProgress);
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

  // Paste an image from the clipboard anywhere on the page to stage it for upload — skipped
  // while the target is a text input/textarea so pasting into search, rename, or the text-asset
  // editor still behaves normally. Staging (rather than uploading immediately) gives the user a
  // chance to see the image and back out of an accidental paste before it becomes a new asset.
  useEffect(() => {
    if (tab !== 'mine' || !canEditContent) return;
    function onPaste(e: ClipboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const item = Array.from(e.clipboardData?.items ?? []).find(i => i.type.startsWith('image/'));
      if (!item) return;
      const blob = item.getAsFile();
      if (!blob) return;
      e.preventDefault();
      const ext = blob.type.split('/')[1] || 'png';
      setPasteConfirm(new File([blob], `pasted-${Date.now()}.${ext}`, { type: blob.type }));
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [tab, canEditContent]);

  const newMenuActions: ContextMenuAction[] = [
    { key: 'upload', label: t('upload'), icon: Upload, disabled: uploading, onClick: () => inputRef.current?.click() },
    { key: 'newText', label: t('newText'), icon: Type, onClick: () => setTextModal('new') },
    { key: 'layout', label: t('newMenu.layout'), icon: LayoutTemplate, separator: true, onClick: () => router.push(`/${locale}/designer?type=layout`) },
    { key: 'theme', label: t('newMenu.theme'), icon: Palette, onClick: () => router.push(`/${locale}/designer?type=theme`) },
    { key: 'wayfinding', label: t('newMenu.wayfinding'), icon: MapPin, onClick: () => router.push(`/${locale}/wayfinding`) },
  ];

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--deck-text-hi)]">{t('title')}</h1>
          <p className="text-sm text-[var(--deck-text-mid)] mt-1">{t('subtitle')}</p>
        </div>
        {tab === 'mine' && canEditContent && (
          <div className="flex items-center gap-3">
            {uploading && (
              <span className="flex items-center gap-1.5 text-xs text-[var(--deck-text-mid)]">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" /> {t('uploading', { progress })}
              </span>
            )}
            <span className="hidden sm:inline text-xs text-[var(--deck-text-low)]">{t('pasteHint')}</span>
            <button onClick={e => {
              const rect = e.currentTarget.getBoundingClientRect();
              setNewMenu({ x: rect.left, y: rect.bottom + 4, actions: newMenuActions });
            }}
              className="flex items-center gap-2 bg-[var(--deck-accent)] text-white px-4 py-2 rounded-lg text-sm font-medium ">
              <Plus className="w-4 h-4" /> {t('newMenu.button')}
            </button>
            <input ref={inputRef} type="file" multiple accept="image/*,video/*,audio/*,application/pdf,.ppt,.pptx,.doc,.docx" className="hidden"
              onChange={e => { void handleFiles(e.target.files); }} />
          </div>
        )}
        {tab === 'apps' && appsView === 'gallery' && canEditContent && (
          <button onClick={() => setAppsView('create')}
            className="flex items-center gap-2 bg-[var(--deck-accent)] text-white px-4 py-2 rounded-lg text-sm font-medium ">
            <Plus className="w-4 h-4" /> {t('apps.createButton')}
          </button>
        )}
        {tab === 'library' && canManageLibrary && (
          <button onClick={() => setShowLibraryUpload(true)}
            className="flex items-center gap-2 bg-[var(--deck-accent)] text-white px-4 py-2 rounded-lg text-sm font-medium ">
            <Upload className="w-4 h-4" /> {t('libraryUpload')}
          </button>
        )}
        {tab === 'designs' && (
          <button onClick={() => router.push(`/${locale}/designer2`)}
            className="flex items-center gap-2 bg-[var(--deck-accent)] text-white px-4 py-2 rounded-lg text-sm font-medium ">
            <Plus className="w-4 h-4" /> {t('newDesign')}
          </button>
        )}
      </div>

      {showLibraryUpload && canManageLibrary && (
        <LibraryUploadModal onClose={() => setShowLibraryUpload(false)} onUploaded={handleLibraryUploaded} />
      )}

      <ContextMenu state={newMenu} onClose={() => setNewMenu(null)} />
      <ContextMenu state={providerMenu} onClose={() => setProviderMenu(null)} />

      {videoUploadChoice && (
        <VideoUploadChoiceModal
          count={videoUploadChoice.videoFiles.length}
          onCancel={() => { setVideoUploadChoice(null); if (inputRef.current) inputRef.current.value = ''; }}
          onChoose={extractAudioOnly => { void resolveVideoUploadChoice(extractAudioOnly); }}
        />
      )}

      {pasteConfirm && (
        <PasteConfirmModal
          file={pasteConfirm}
          onCancel={() => setPasteConfirm(null)}
          onConfirm={() => { const file = pasteConfirm; setPasteConfirm(null); void runUpload([{ file, extractAudioOnly: false }]); }}
        />
      )}

      <div className="flex gap-1 mb-6 border-b border-[var(--deck-glass-border)]">
        <button onClick={() => setTab('mine')}
          className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === 'mine' ? 'border-[var(--deck-accent)] text-[var(--deck-accent)]' : 'border-transparent text-[var(--deck-text-mid)] hover:text-[var(--deck-text-hi)]'}`}>
          <ImageIcon className="w-4 h-4" /> {t('myAssetsTab')}
        </button>
        <button onClick={() => setTab('apps')}
          className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === 'apps' ? 'border-[var(--deck-accent)] text-[var(--deck-accent)]' : 'border-transparent text-[var(--deck-text-mid)] hover:text-[var(--deck-text-hi)]'}`}>
          <LayoutGrid className="w-4 h-4" /> {t('appsTab')}
        </button>
        <button onClick={() => setTab('library')}
          className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === 'library' ? 'border-[var(--deck-accent)] text-[var(--deck-accent)]' : 'border-transparent text-[var(--deck-text-mid)] hover:text-[var(--deck-text-hi)]'}`}>
          <Library className="w-4 h-4" /> {t('libraryTab')}
        </button>
        <button onClick={() => setTab('designs')}
          className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === 'designs' ? 'border-[var(--deck-accent)] text-[var(--deck-accent)]' : 'border-transparent text-[var(--deck-text-mid)] hover:text-[var(--deck-text-hi)]'}`}>
          <LayoutTemplate className="w-4 h-4" /> {t('designsTab')}
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

      {nonAppAssets.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-5">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-[var(--deck-text-low)] absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder={tc('search')}
              className="w-full border border-[var(--deck-glass-border)] rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--deck-accent)]" />
          </div>
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value as Asset['type'] | '')}
            className="border border-[var(--deck-glass-border)] rounded-lg px-3 py-2 text-sm focus:outline-none">
            <option value="">{t('allTypes')}</option>
            <option value="IMAGE">{t('typeFilter.IMAGE')}</option>
            <option value="VIDEO">{t('typeFilter.VIDEO')}</option>
            <option value="AUDIO">{t('typeFilter.AUDIO')}</option>
            <option value="DOCUMENT">{t('typeFilter.DOCUMENT')}</option>
            <option value="TEXT">{t('typeFilter.TEXT')}</option>
          </select>
          <select value={usageFilter} onChange={e => setUsageFilter(e.target.value as '' | 'IN_USE' | 'UNUSED')}
            className="border border-[var(--deck-glass-border)] rounded-lg px-3 py-2 text-sm focus:outline-none">
            <option value="">{t('allUsage')}</option>
            <option value="IN_USE">{t('inUse')}</option>
            <option value="UNUSED">{t('unused')}</option>
          </select>
        </div>
      )}

      {isLoading && <p className="text-sm text-[var(--deck-text-low)]">{t('loading')}</p>}

      {!isLoading && nonAppAssets.length === 0 && (
        <div className="text-center py-16 text-[var(--deck-text-low)]">
          <ImageIcon className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{t('empty')}</p>
        </div>
      )}

      {!isLoading && nonAppAssets.length > 0 && filteredAssets.length === 0 && (
        <div className="text-center py-16 text-[var(--deck-text-low)]">
          <Search className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{tc('noMatches')}</p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {filteredAssets.map((asset: Asset) => (
          <div key={asset.id} className="glass-panel rounded-2xl border border-[var(--deck-glass-border)] overflow-hidden group">
            {/* Thumbnail — click to view full size (images) or edit (text) */}
            <div className="group/thumb relative w-full aspect-video bg-[var(--deck-glass-fill-strong)] flex items-center justify-center">
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
                  <div className="text-[var(--deck-text-low)]">{assetIcon(asset)}</div>
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
                      className="w-full text-sm font-medium text-[var(--deck-text-hi)] border border-[var(--deck-accent)] rounded px-1 -mx-1 focus:outline-none focus:ring-1 focus:ring-[var(--deck-accent)]"
                    />
                  ) : (
                    <p
                      onClick={() => startRename(asset)}
                      title={canEditContent ? tc('clickToRename') : undefined}
                      className={`text-sm font-medium text-[var(--deck-text-hi)] truncate ${canEditContent ? 'cursor-text hover:text-[var(--deck-accent)]' : ''}`}>
                      {asset.name}
                    </p>
                  )}
                  <p className="text-xs text-[var(--deck-text-low)] mt-0.5 flex items-center gap-1">
                    {assetIcon(asset)} {formatBytes(asset.sizeBytes)}
                    {asset.inUse && (
                      <span className="ms-1 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 font-medium">
                        {t('inUse')}
                      </span>
                    )}
                  </p>
                  {asset.type === 'VIDEO' && asset.status === 'READY' && asset.hasAudioTrack && (
                    <label className={`flex items-center gap-1.5 text-xs text-[var(--deck-text-mid)] mt-1 ${canEditContent ? 'cursor-pointer' : ''}`}>
                      <input type="checkbox" checked={asset.audioEnabled} disabled={!canEditContent}
                        onChange={e => audioMut.mutate({ id: asset.id, audioEnabled: e.target.checked })}
                        className="w-3.5 h-3.5 accent-[var(--deck-accent)] disabled:opacity-50" />
                      <Volume2 className="w-3 h-3" /> {t('includeAudio')}
                    </label>
                  )}
                </div>
                <div className="flex items-center shrink-0">
                  {canEditContent && asset.type === 'VIDEO' && asset.status === 'READY' && asset.hasAudioTrack && (
                    <button onClick={() => extractAudioMut.mutate(asset)}
                      disabled={extractAudioMut.isPending && extractAudioMut.variables?.id === asset.id}
                      title={t('convertToAudio')}
                      className="p-1 text-[var(--deck-text-low)] hover:text-[var(--deck-accent)] transition-colors disabled:opacity-50">
                      <AudioLines className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {asset.downloadUrl && (
                    <a href={asset.downloadUrl} title={t('download')}
                      className="p-1 text-[var(--deck-text-low)] hover:text-[var(--deck-accent)] transition-colors">
                      <Download className="w-3.5 h-3.5" />
                    </a>
                  )}
                  {canEditContent && (
                    <button onClick={() => { if (confirmDelete(t('deleteConfirm'))) removeMut.mutate(asset); }}
                      className="p-1 text-[var(--deck-text-low)] hover:text-red-500 transition-colors">
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

      {tab === 'apps' && appsView === 'gallery' && (
        <div>
          {appAssets.length === 0 && (
            <div className="text-center py-16 text-[var(--deck-text-low)]">
              <LayoutGrid className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">{t('apps.galleryEmpty')}</p>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {appAssets.map((asset: Asset) => {
              const playlistConfig = asset.appConfig?.kind === 'playlist' ? asset.appConfig : null;
              const thumbnailUrl = playlistConfig ? (playlistConfig.items[0]?.thumbnailUrl ?? null) : asset.thumbnailUrl;
              return (
                <div key={asset.id} className="glass-panel rounded-2xl border border-[var(--deck-glass-border)] overflow-hidden group">
                  <div className="group/thumb relative w-full aspect-video bg-[var(--deck-glass-fill-strong)] flex items-center justify-center">
                    <button
                      onClick={() => { if (!playlistConfig && asset.sourceUrl) window.open(asset.sourceUrl, '_blank', 'noopener,noreferrer'); }}
                      disabled={!!playlistConfig || !asset.sourceUrl}
                      className="absolute inset-0 w-full h-full flex items-center justify-center disabled:cursor-default">
                      {thumbnailUrl ? (
                        // External oEmbed thumbnail — not in next/image's remotePatterns allowlist
                        // (see next.config.mjs); adding every future provider's thumbnail host
                        // there would undercut "new apps need no core changes."
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumbnailUrl} alt={asset.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="text-[var(--deck-text-low)]">{assetIcon(asset)}</div>
                      )}
                      {!playlistConfig && asset.sourceUrl && (
                        <div className="absolute inset-0 bg-black/0 group-hover/thumb:bg-black/40 flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition-all">
                          <span className="flex items-center gap-1.5 text-white text-xs font-medium">
                            <ExternalLink className="w-3.5 h-3.5" /> {t('apps.openSource')}
                          </span>
                        </div>
                      )}
                      {playlistConfig && (
                        <span className="absolute bottom-1.5 end-1.5 flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-black/60 text-white">
                          {playlistConfig.playbackOrder === 'SHUFFLE' ? <Shuffle className="w-3 h-3" /> : <ListOrdered className="w-3 h-3" />}
                          {t('apps.itemCount', { count: playlistConfig.items.length })}
                        </span>
                      )}
                    </button>
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
                            className="w-full text-sm font-medium text-[var(--deck-text-hi)] border border-[var(--deck-accent)] rounded px-1 -mx-1 focus:outline-none focus:ring-1 focus:ring-[var(--deck-accent)]"
                          />
                        ) : (
                          <p
                            onClick={() => startRename(asset)}
                            title={canEditContent ? tc('clickToRename') : undefined}
                            className={`text-sm font-medium text-[var(--deck-text-hi)] truncate ${canEditContent ? 'cursor-text hover:text-[var(--deck-accent)]' : ''}`}>
                            {asset.name}
                          </p>
                        )}
                        <p className="text-xs text-[var(--deck-text-low)] mt-0.5 flex items-center gap-1">
                          {assetIcon(asset)} {appProviders.find(p => p.id === asset.appProviderId)?.name ?? asset.appProviderId}
                        </p>
                      </div>
                      {canEditContent && (
                        <button onClick={() => { if (confirmDelete(t('deleteConfirm'))) removeMut.mutate(asset); }}
                          className="p-1 text-[var(--deck-text-low)] hover:text-red-500 transition-colors shrink-0">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === 'apps' && appsView === 'create' && (
        <div>
          <button onClick={() => setAppsView('gallery')}
            className="flex items-center gap-1.5 text-sm text-[var(--deck-text-mid)] hover:text-[var(--deck-text-hi)] mb-4">
            <ArrowLeft className="w-3.5 h-3.5" /> {t('apps.backToGallery')}
          </button>
          {appProviders.length === 0 && (
            <div className="text-center py-16 text-[var(--deck-text-low)]">
              <LayoutGrid className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">{t('apps.empty')}</p>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {appProviders.map((provider: AppProvider) => (
              <button key={provider.id}
                onClick={e => {
                  if (!canEditContent) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  setProviderMenu({
                    x: rect.left, y: rect.bottom + 4,
                    actions: [
                      { key: 'video', label: t('apps.addVideo'), icon: SquarePlay, onClick: () => setAppModalProvider(provider) },
                      { key: 'playlist', label: t('apps.createPlaylist'), icon: ListVideo, onClick: () => setAppPlaylistModalProvider(provider) },
                    ],
                  });
                }}
                disabled={!canEditContent}
                className="flex flex-col items-center gap-2 glass-panel rounded-2xl border border-[var(--deck-glass-border)] p-6 hover:border-[var(--deck-accent)] transition-colors disabled:opacity-50 disabled:cursor-default">
                <div className="scale-[2]">{PROVIDER_ICON[provider.id] ?? <LayoutGrid className="w-4 h-4" />}</div>
                <span className="text-sm font-medium text-[var(--deck-text-hi)] mt-2">{provider.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {appModalProvider && canEditContent && (
        <AppAssetModal
          provider={appModalProvider}
          onClose={() => setAppModalProvider(null)}
          onCreated={handleAppCreated}
        />
      )}

      {appPlaylistModalProvider && canEditContent && (
        <AppPlaylistModal
          provider={appPlaylistModalProvider}
          onClose={() => setAppPlaylistModalProvider(null)}
          onCreated={handleAppCreated}
        />
      )}

      {tab === 'library' && (
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-5">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 text-[var(--deck-text-low)] absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input value={librarySearch} onChange={e => setLibrarySearch(e.target.value)}
                placeholder={t('librarySearchPlaceholder')}
                className="w-full border border-[var(--deck-glass-border)] rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--deck-accent)]" />
            </div>
            <select value={libraryCategory} onChange={e => setLibraryCategory(e.target.value as AssetCategory | '')}
              className="border border-[var(--deck-glass-border)] rounded-lg px-3 py-2 text-sm focus:outline-none">
              <option value="">{t('allCategories')}</option>
              {CATEGORY_VALUES.map(c => <option key={c} value={c}>{t(`categories.${c}`)}</option>)}
            </select>
          </div>

          {libraryLoading && <p className="text-sm text-[var(--deck-text-low)]">{t('loading')}</p>}

          {!libraryLoading && libraryAssets.length === 0 && (
            <div className="text-center py-16 text-[var(--deck-text-low)]">
              <Library className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">{t('libraryEmpty')}</p>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {libraryAssets.map((asset: Asset) => (
              <div key={asset.id} className="glass-panel rounded-2xl border border-[var(--deck-glass-border)] overflow-hidden">
                <div className="relative w-full aspect-video bg-[var(--deck-glass-fill-strong)] flex items-center justify-center">
                  {asset.thumbnailUrl ? (
                    <Image
                    src={asset.thumbnailUrl}
                    alt={asset.name}
                    fill
                    sizes="(min-width: 1024px) 25vw, (min-width: 768px) 33vw, (min-width: 640px) 50vw, 100vw"
                    className="object-cover"
                  />
                  ) : (
                    <div className="text-[var(--deck-text-low)]">{typeIcon[asset.type]}</div>
                  )}
                </div>
                <div className="p-3">
                  {libraryRenamingId === asset.id ? (
                    <input
                      autoFocus
                      value={libraryRenameValue}
                      onChange={e => setLibraryRenameValue(e.target.value)}
                      onBlur={() => commitLibraryRename(asset)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') commitLibraryRename(asset);
                        if (e.key === 'Escape') setLibraryRenamingId(null);
                      }}
                      disabled={updateLibraryMut.isPending}
                      className="w-full text-sm font-medium text-[var(--deck-text-hi)] border border-[var(--deck-accent)] rounded px-1 -mx-1 focus:outline-none focus:ring-1 focus:ring-[var(--deck-accent)]"
                    />
                  ) : (
                    <p
                      onClick={() => startLibraryRename(asset)}
                      title={canManageLibrary ? tc('clickToRename') : undefined}
                      className={`text-sm font-medium text-[var(--deck-text-hi)] truncate ${canManageLibrary ? 'cursor-text hover:text-[var(--deck-accent)]' : ''}`}>
                      {asset.name}
                    </p>
                  )}

                  {canManageLibrary ? (
                    <select value={asset.category}
                      onChange={e => updateLibraryMut.mutate({ id: asset.id, category: e.target.value as AssetCategory })}
                      className="w-full text-xs text-[var(--deck-text-mid)] mt-1 mb-1.5 border border-[var(--deck-glass-border)] rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-[var(--deck-accent)]">
                      {CATEGORY_VALUES.map(c => <option key={c} value={c}>{t(`categories.${c}`)}</option>)}
                    </select>
                  ) : (
                    <p className="text-xs text-[var(--deck-text-low)] mt-0.5 mb-2 flex items-center gap-1">
                      {typeIcon[asset.type]} {t(`categories.${asset.category}`)}
                    </p>
                  )}

                  {canManageLibrary && (
                    <input
                      defaultValue={asset.tags.join(', ')}
                      placeholder={t('libraryTagsPlaceholder')}
                      onBlur={e => commitLibraryTags(asset, e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                      className="w-full text-xs text-[var(--deck-text-mid)] mb-2 border border-[var(--deck-glass-border)] rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-[var(--deck-accent)]"
                    />
                  )}

                  {canEditContent && (
                    <button onClick={() => useFromLibraryMut.mutate(asset)}
                      disabled={useFromLibraryMut.isPending}
                      className="w-full flex items-center justify-center gap-1.5 text-xs bg-[var(--deck-accent-soft)] text-[var(--deck-accent)] rounded-lg py-1.5 hover:bg-[var(--deck-accent-soft)] disabled:opacity-50">
                      {justAddedId === asset.id
                        ? <><Check className="w-3.5 h-3.5" /> {t('addedToMyAssets')}</>
                        : <><CopyPlus className="w-3.5 h-3.5" /> {t('addToMyAssets')}</>}
                    </button>
                  )}
                  {canManageLibrary && (
                    <button onClick={() => { if (confirmDelete(t('libraryDeleteConfirm'))) removeLibraryMut.mutate(asset); }}
                      disabled={removeLibraryMut.isPending && removeLibraryMut.variables?.id === asset.id}
                      className="w-full flex items-center justify-center gap-1.5 text-xs text-red-600 dark:text-red-400 rounded-lg py-1.5 hover:bg-red-50 dark:hover:bg-red-950 disabled:opacity-50">
                      <Trash2 className="w-3.5 h-3.5" /> {tc('delete')}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          {libraryDeleteError && <p className="text-xs text-red-600 mt-3">{libraryDeleteError}</p>}
        </div>
      )}

      {tab === 'designs' && (
        <div>
          {designsLoading && <p className="text-sm text-[var(--deck-text-low)]">{t('loading')}</p>}

          {!designsLoading && designs.length === 0 && (
            <div className="text-center py-16 text-[var(--deck-text-low)]">
              <LayoutTemplate className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">{t('designsEmpty')}</p>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {designs.map((design: DesignAsset) => (
              <div
                key={design.id}
                role="button"
                tabIndex={0}
                onClick={() => router.push(`/${locale}/designer2?designId=${design.id}`)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); router.push(`/${locale}/designer2?designId=${design.id}`); } }}
                className="cursor-pointer text-start glass-panel rounded-2xl border border-[var(--deck-glass-border)] overflow-hidden hover:border-[var(--deck-accent)]"
              >
                <div className="relative w-full aspect-video bg-[var(--deck-glass-fill-strong)] flex items-center justify-center text-[var(--deck-text-low)] overflow-hidden">
                  {design.designJson.scenes.length > 0
                    ? <DesignPreview document={design.designJson} assetUrlById={assetUrlById} />
                    : <LayoutTemplate className="w-8 h-8" />}
                </div>
                <div className="p-3">
                  {renamingDesignId === design.id ? (
                    <input
                      autoFocus
                      value={designRenameValue}
                      onClick={e => e.stopPropagation()}
                      onChange={e => setDesignRenameValue(e.target.value)}
                      onBlur={() => commitRenameDesign(design)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') commitRenameDesign(design);
                        if (e.key === 'Escape') setRenamingDesignId(null);
                      }}
                      disabled={renameDesignMut.isPending}
                      className="w-full text-sm font-medium text-[var(--deck-text-hi)] glass-panel rounded px-1 -mx-1 border border-[var(--deck-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--deck-accent)]"
                    />
                  ) : (
                    <p
                      onClick={e => { e.stopPropagation(); startRenameDesign(design); }}
                      title={canEditContent ? tc('clickToRename') : undefined}
                      className={`truncate text-sm font-medium text-[var(--deck-text-hi)] ${canEditContent ? 'cursor-text hover:text-[var(--deck-accent)]' : ''}`}>
                      {design.name}
                    </p>
                  )}
                  <p className="text-xs text-[var(--deck-text-low)] mt-0.5">
                    {new Date(design.updatedAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AssetsPage() {
  return (
    <Suspense fallback={null}>
      <AssetsPageInner />
    </Suspense>
  );
}
