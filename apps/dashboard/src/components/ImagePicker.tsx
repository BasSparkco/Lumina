'use client';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload, Clipboard, RefreshCw, Wand2 } from 'lucide-react';
import { assetsApi } from '@/lib/api';
import { removeAssetBackground } from '@/lib/backgroundRemoval';

type Mode = 'existing' | 'upload' | 'paste';

interface ImagePickerProps {
  value: string | null;
  onChange: (assetId: string | null) => void;
  placeholder: string;
  disabled?: boolean;
  labels: {
    existing: string;
    upload: string;
    paste: string;
    uploading: string;
    uploadFailed: string;
    pasteHint: string;
    pasteError: string;
    removeBackground: string;
    removingBackground: string;
    removeBackgroundFailed: string;
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
      <div className="flex gap-0.5 rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800">
        {(['existing', 'upload', 'paste'] as const).map((m) => (
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
        <select
          value={value ?? ''}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value || null)}
          className="w-full rounded border border-gray-200 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
        >
          <option value="">{placeholder}</option>
          {options.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
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
          className="flex min-h-[46px] w-full cursor-text items-center justify-center gap-1.5 rounded border border-dashed border-gray-300 px-2 py-1.5 text-center text-[11px] text-gray-500 focus:border-indigo-400 focus:outline-none dark:border-gray-700 dark:text-gray-400"
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

      {error && <p className="text-[10px] text-red-500">{error}</p>}

      {preview && (
        <div
          className="overflow-hidden rounded border border-gray-200 bg-gray-50 bg-[length:16px_16px] bg-[image:repeating-conic-gradient(#e5e7eb_0%_25%,transparent_0%_50%)] dark:border-gray-700 dark:bg-gray-800 dark:bg-[image:repeating-conic-gradient(#374151_0%_25%,transparent_0%_50%)]"
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
          className="flex w-full items-center justify-center gap-1.5 rounded border border-dashed border-gray-300 px-2 py-1.5 text-[11px] text-gray-600 hover:border-indigo-400 hover:text-indigo-600 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300"
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
