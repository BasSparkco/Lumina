'use client';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload, Clipboard, RefreshCw, Wand2, Search, ImageOff } from 'lucide-react';
import { assetsApi, type StockPhoto } from '@/lib/api';
import { removeAssetBackground } from '@/lib/backgroundRemoval';
import { AssetSelect } from './AssetSelect';

type Mode = 'existing' | 'upload' | 'paste' | 'stock';

interface ImagePickerProps {
  value: string | null;
  onChange: (assetId: string | null) => void;
  placeholder: string;
  disabled?: boolean;
  labels: {
    existing: string;
    upload: string;
    paste: string;
    stock: string;
    uploading: string;
    uploadFailed: string;
    pasteHint: string;
    pasteError: string;
    removeBackground: string;
    removingBackground: string;
    removeBackgroundFailed: string;
    stockSearchPlaceholder: string;
    stockEmpty: string;
    stockNotConfigured: string;
    stockCredit: string;
    importStockFailed: string;
  };
}

// Three ways to get an image onto an element without leaving the editor: pick something already
// uploaded, upload a new file from disk, or paste straight from the clipboard (screenshot tools,
// "copy image" from a browser, etc.) — all three land on the same assetId, and whichever one was
// just picked previews immediately below instead of the generic kind-badge placeholder.
export function ImagePicker({ value, onChange, placeholder, disabled, labels }: ImagePickerProps) {
  const qc = useQueryClient();
  const { data: assets = [] } = useQuery({ queryKey: ['assets'], queryFn: assetsApi.list });
  const options = assets.filter((a) => a.type === 'IMAGE' && a.status === 'READY');
  // Not gated on status === 'READY': the raw file is already stored the moment upload() returns,
  // only thumbnail generation is async — so the original url is a valid preview well before the
  // asset finishes processing.
  const selected = value ? assets.find((a) => a.id === value) : undefined;

  const [mode, setMode] = useState<Mode>('existing');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [removingBg, setRemovingBg] = useState(false);
  const [bgProgress, setBgProgress] = useState(0);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Once `selected` resolves to a real asset, its url always wins in the `preview` fallback below
  // — so a stale localPreview object URL is never rendered again after that, only revoked (either
  // right before the next upload replaces it, or on unmount) to avoid leaking it.
  const localPreviewRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (localPreviewRef.current) URL.revokeObjectURL(localPreviewRef.current);
    };
  }, []);

  async function uploadFile(file: File) {
    setError('');
    setBusy(true);
    setProgress(0);
    if (localPreviewRef.current) URL.revokeObjectURL(localPreviewRef.current);
    const localUrl = URL.createObjectURL(file);
    localPreviewRef.current = localUrl;
    setLocalPreview(localUrl);
    try {
      const asset = await assetsApi.upload(file, setProgress);
      void qc.invalidateQueries({ queryKey: ['assets'] });
      onChange(asset.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : labels.uploadFailed);
      URL.revokeObjectURL(localUrl);
      localPreviewRef.current = null;
      setLocalPreview(null);
    } finally {
      setBusy(false);
      setProgress(0);
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith('image/'));
    if (!item) {
      setError(labels.pasteError);
      return;
    }
    const blob = item.getAsFile();
    if (!blob) return;
    setError('');
    const ext = blob.type.split('/')[1] ?? 'png';
    void uploadFile(new File([blob], `pasted-${Date.now()}.${ext}`, { type: blob.type }));
  }

  const preview = (selected && (selected.thumbnailUrl ?? selected.url)) || localPreview;

  // Runs entirely client-side (no server round trip, no third-party API): loads an ONNX
  // segmentation model on first use (cached by the library in IndexedDB afterward) and produces a
  // transparent-background PNG, which is uploaded as a brand new asset so the original stays
  // untouched and reusable elsewhere. Only offered once a real asset is selected — background
  // removal needs a persisted source image to run against.
  async function handleRemoveBackground() {
    if (!selected) return;
    setError('');
    setRemovingBg(true);
    setBgProgress(0);
    try {
      const asset = await removeAssetBackground(selected, setBgProgress);
      void qc.invalidateQueries({ queryKey: ['assets'] });
      onChange(asset.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : labels.removeBackgroundFailed);
    } finally {
      setRemovingBg(false);
      setBgProgress(0);
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex gap-0.5 rounded-lg bg-[var(--deck-glass-fill-strong)] p-0.5">
        {(['existing', 'upload', 'paste', 'stock'] as const).map((m) => (
          <button
            key={m}
            type="button"
            disabled={disabled}
            onClick={() => setMode(m)}
            className={`flex-1 rounded px-1.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-50 ${
              mode === m
                ? 'bg-[var(--deck-glass-fill-strong)] text-[var(--deck-accent)] shadow-sm'
                : 'text-[var(--deck-text-mid)] hover:text-[var(--deck-text-hi)]'
            }`}
          >
            {labels[m]}
          </button>
        ))}
      </div>

      {mode === 'existing' && (
        <AssetSelect assets={options} value={value} onChange={onChange} disabled={disabled} placeholder={placeholder} />
      )}

      {mode === 'upload' && (
        <div>
          <button
            type="button"
            disabled={disabled || busy}
            onClick={() => inputRef.current?.click()}
            className="flex w-full items-center justify-center gap-1.5 rounded border border-dashed border-[var(--deck-glass-border)] px-2 py-1.5 text-[11px] text-[var(--deck-text-mid)] hover:border-[var(--deck-accent)] hover:text-[var(--deck-accent)] disabled:opacity-50"
          >
            {busy ? (
              <>
                <RefreshCw className="h-3 w-3 animate-spin" />
                {labels.uploading} {progress}%
              </>
            ) : (
              <>
                <Upload className="h-3 w-3" /> {labels.upload}
              </>
            )}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void uploadFile(file);
              e.target.value = '';
            }}
          />
        </div>
      )}

      {mode === 'paste' && (
        <div
          tabIndex={0}
          onPaste={handlePaste}
          className="flex min-h-[46px] w-full cursor-text items-center justify-center gap-1.5 rounded border border-dashed border-[var(--deck-glass-border)] px-2 py-1.5 text-center text-[11px] text-[var(--deck-text-mid)] focus:border-[var(--deck-accent)] focus:outline-none"
        >
          {busy ? (
            <>
              <RefreshCw className="h-3 w-3 animate-spin" />
              {labels.uploading} {progress}%
            </>
          ) : (
            <>
              <Clipboard className="h-3 w-3 shrink-0" /> {labels.pasteHint}
            </>
          )}
        </div>
      )}

      {mode === 'stock' && (
        <StockPhotosTab
          disabled={disabled}
          onImported={(assetId) => {
            void qc.invalidateQueries({ queryKey: ['assets'] });
            onChange(assetId);
          }}
          labels={labels}
        />
      )}

      {error && <p className="text-[10px] text-red-500">{error}</p>}

      {preview && (
        <div
          className="overflow-hidden rounded border border-[var(--deck-glass-border)] bg-[var(--deck-glass-fill-strong)] bg-[length:16px_16px] bg-[image:repeating-conic-gradient(#e5e7eb_0%_25%,transparent_0%_50%)] dark:bg-[image:repeating-conic-gradient(#374151_0%_25%,transparent_0%_50%)]"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary remote asset URL / local object URL, not a static/local image */}
          <img src={preview} alt="" className="block max-h-28 w-full object-contain" />
        </div>
      )}

      {selected && (
        <button
          type="button"
          disabled={disabled || busy || removingBg}
          onClick={() => void handleRemoveBackground()}
          className="flex w-full items-center justify-center gap-1.5 rounded border border-dashed border-[var(--deck-glass-border)] px-2 py-1.5 text-[11px] text-[var(--deck-text-mid)] hover:border-[var(--deck-accent)] hover:text-[var(--deck-accent)] disabled:opacity-50"
        >
          {removingBg ? (
            <>
              <RefreshCw className="h-3 w-3 animate-spin" />
              {labels.removingBackground} {bgProgress > 0 ? `${bgProgress}%` : ''}
            </>
          ) : (
            <>
              <Wand2 className="h-3 w-3" /> {labels.removeBackground}
            </>
          )}
        </button>
      )}
    </div>
  );
}

type StockLabels = Pick<
  ImagePickerProps['labels'],
  'stockSearchPlaceholder' | 'stockEmpty' | 'stockNotConfigured' | 'stockCredit' | 'importStockFailed'
>;

// Search Pexels and drop the picked photo straight in as a brand-new asset — same "produces an
// assetId, nothing more" contract as the upload/paste tabs, just sourced from a stock library
// instead of the user's own files. The Pexels key itself never reaches this component: search
// and import both go through the API, which proxies to Pexels server-side.
function StockPhotosTab({
  disabled,
  onImported,
  labels,
}: {
  disabled?: boolean;
  onImported: (assetId: string) => void;
  labels: StockLabels;
}) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [importingId, setImportingId] = useState<number | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 400);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isFetching } = useQuery({
    queryKey: ['stockPhotos', debouncedSearch],
    queryFn: () => assetsApi.searchStockPhotos({ query: debouncedSearch || undefined }),
    staleTime: 5 * 60 * 1000,
  });

  async function handlePick(photo: StockPhoto) {
    if (importingId) return;
    setError('');
    setImportingId(photo.id);
    try {
      const asset = await assetsApi.importStockPhoto(photo.id);
      onImported(asset.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : labels.importStockFailed);
    } finally {
      setImportingId(null);
    }
  }

  if (data && !data.configured) {
    return <p className="px-1 py-2 text-[11px] text-[var(--deck-text-mid)]">{labels.stockNotConfigured}</p>;
  }

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--deck-text-low)]" />
        <input
          type="text"
          disabled={disabled}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={labels.stockSearchPlaceholder}
          className="w-full rounded border border-[var(--deck-glass-border)] py-1 pl-6 pr-2 text-[11px] focus:border-[var(--deck-accent)] focus:outline-none disabled:opacity-50"
        />
      </div>

      {isFetching ? (
        <div className="flex items-center justify-center gap-1.5 py-4 text-[11px] text-[var(--deck-text-low)]">
          <RefreshCw className="h-3 w-3 animate-spin" />
        </div>
      ) : !data?.photos.length ? (
        <div className="flex flex-col items-center gap-1 py-4 text-center text-[11px] text-[var(--deck-text-low)]">
          <ImageOff className="h-4 w-4" />
          {labels.stockEmpty}
        </div>
      ) : (
        <div className="grid max-h-52 grid-cols-3 gap-1 overflow-y-auto">
          {data.photos.map((photo) => (
            <button
              key={photo.id}
              type="button"
              disabled={disabled || importingId !== null}
              onClick={() => void handlePick(photo)}
              title={photo.alt ?? undefined}
              className="relative aspect-square overflow-hidden rounded border border-[var(--deck-glass-border)] disabled:cursor-wait"
              style={{ opacity: importingId !== null && importingId !== photo.id ? 0.5 : 1 }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary remote Pexels thumbnail, not a static/local image */}
              <img src={photo.thumbnailUrl} alt="" className="h-full w-full object-cover" />
              {importingId === photo.id && (
                <span className="absolute inset-0 flex items-center justify-center bg-black/40">
                  <RefreshCw className="h-4 w-4 animate-spin text-white" />
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {error && <p className="text-[10px] text-red-500">{error}</p>}

      {!!data?.photos.length && <p className="text-center text-[10px] text-[var(--deck-text-low)]">{labels.stockCredit}</p>}
    </div>
  );
}
