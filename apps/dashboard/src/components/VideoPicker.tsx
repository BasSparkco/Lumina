'use client';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload, RefreshCw, Search, VideoOff } from 'lucide-react';
import { assetsApi, type StockVideo } from '@/lib/api';
import { AssetSelect } from './AssetSelect';

type Mode = 'existing' | 'upload' | 'stock';

interface VideoPickerProps {
  value: string | null;
  onChange: (assetId: string | null) => void;
  placeholder: string;
  disabled?: boolean;
  labels: {
    existing: string;
    upload: string;
    stock: string;
    uploading: string;
    uploadFailed: string;
    stockSearchPlaceholder: string;
    stockEmpty: string;
    stockNotConfigured: string;
    stockCredit: string;
    importStockFailed: string;
  };
}

// Two ways to get a video onto an element without leaving the editor: pick something already
// uploaded, or upload a new file from disk — plus a stock tab sourced from Pexels. Mirrors
// ImagePicker's existing/upload/stock tabs; no paste (browsers don't support pasting video from
// the clipboard) and no background removal (image-only).
export function VideoPicker({ value, onChange, placeholder, disabled, labels }: VideoPickerProps) {
  const qc = useQueryClient();
  const { data: assets = [] } = useQuery({ queryKey: ['assets'], queryFn: assetsApi.list });
  const options = assets.filter((a) => a.type === 'VIDEO' && a.status === 'READY');
  const selected = value ? assets.find((a) => a.id === value) : undefined;

  const [mode, setMode] = useState<Mode>('existing');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
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

  const preview = (selected && (selected.thumbnailUrl ?? selected.url)) || localPreview;

  return (
    <div className="space-y-1.5">
      <div className="flex gap-0.5 rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800">
        {(['existing', 'upload', 'stock'] as const).map((m) => (
          <button
            key={m}
            type="button"
            disabled={disabled}
            onClick={() => setMode(m)}
            className={`flex-1 rounded px-1.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-50 ${
              mode === m
                ? 'bg-white text-indigo-600 shadow-sm dark:bg-gray-700 dark:text-indigo-300'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
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
            className="flex w-full items-center justify-center gap-1.5 rounded border border-dashed border-gray-300 px-2 py-1.5 text-[11px] text-gray-600 hover:border-indigo-400 hover:text-indigo-600 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300"
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
            accept="video/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void uploadFile(file);
              e.target.value = '';
            }}
          />
        </div>
      )}

      {mode === 'stock' && (
        <StockVideosTab
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
        <div className="overflow-hidden rounded border border-gray-200 bg-black dark:border-gray-700">
          <video src={preview} muted controls className="block max-h-28 w-full" />
        </div>
      )}
    </div>
  );
}

type StockLabels = Pick<
  VideoPickerProps['labels'],
  'stockSearchPlaceholder' | 'stockEmpty' | 'stockNotConfigured' | 'stockCredit' | 'importStockFailed'
>;

// Search Pexels and drop the picked video straight in as a brand-new asset — same contract and
// same "key never reaches the browser" proxy pattern as ImagePicker's StockPhotosTab.
function StockVideosTab({
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
    queryKey: ['stockVideos', debouncedSearch],
    queryFn: () => assetsApi.searchStockVideos({ query: debouncedSearch || undefined }),
    staleTime: 5 * 60 * 1000,
  });

  async function handlePick(video: StockVideo) {
    if (importingId) return;
    setError('');
    setImportingId(video.id);
    try {
      const asset = await assetsApi.importStockVideo(video.id);
      onImported(asset.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : labels.importStockFailed);
    } finally {
      setImportingId(null);
    }
  }

  if (data && !data.configured) {
    return <p className="px-1 py-2 text-[11px] text-gray-500 dark:text-gray-400">{labels.stockNotConfigured}</p>;
  }

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          disabled={disabled}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={labels.stockSearchPlaceholder}
          className="w-full rounded border border-gray-200 py-1 pl-6 pr-2 text-[11px] focus:border-indigo-400 focus:outline-none disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
        />
      </div>

      {isFetching ? (
        <div className="flex items-center justify-center gap-1.5 py-4 text-[11px] text-gray-400">
          <RefreshCw className="h-3 w-3 animate-spin" />
        </div>
      ) : !data?.videos.length ? (
        <div className="flex flex-col items-center gap-1 py-4 text-center text-[11px] text-gray-400">
          <VideoOff className="h-4 w-4" />
          {labels.stockEmpty}
        </div>
      ) : (
        <div className="grid max-h-52 grid-cols-3 gap-1 overflow-y-auto">
          {data.videos.map((video) => (
            <button
              key={video.id}
              type="button"
              disabled={disabled || importingId !== null}
              onClick={() => void handlePick(video)}
              title={`${video.photographer} · ${Math.round(video.duration)}s`}
              className="relative aspect-square overflow-hidden rounded border border-gray-200 disabled:cursor-wait dark:border-gray-700"
              style={{ opacity: importingId !== null && importingId !== video.id ? 0.5 : 1 }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary remote Pexels thumbnail, not a static/local image */}
              <img src={video.thumbnailUrl} alt="" className="h-full w-full object-cover" />
              <span className="absolute bottom-0.5 right-0.5 rounded bg-black/60 px-1 text-[9px] text-white">
                {Math.round(video.duration)}s
              </span>
              {importingId === video.id && (
                <span className="absolute inset-0 flex items-center justify-center bg-black/40">
                  <RefreshCw className="h-4 w-4 animate-spin text-white" />
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {error && <p className="text-[10px] text-red-500">{error}</p>}

      {!!data?.videos.length && <p className="text-center text-[10px] text-gray-400">{labels.stockCredit}</p>}
    </div>
  );
}
