'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Clipboard, RefreshCw } from 'lucide-react';
import { assetsApi } from '@/lib/api';
import { AssetSelect } from './AssetSelect';

interface AssetPickerProps {
  value: string | null;
  onChange: (assetId: string | null) => void;
  placeholder: string;
  disabled?: boolean;
  // Restricts the list to specific asset types — defaults to every type playable standalone
  // (image/video/document). Theme IMAGE/VIDEO/DOCUMENT elements each pass a single-type list so
  // e.g. an IMAGE element can't be pointed at a video asset. TEXT is opt-in only (theme TEXT
  // elements' "from asset" mode) since it's not part of the general default.
  types?: ('IMAGE' | 'VIDEO' | 'DOCUMENT' | 'TEXT')[];
  // Optional, translated overrides for the loading/error states — every existing call site keeps
  // working unchanged (falls back to a plain English default) without needing to thread a new
  // i18n key through immediately.
  loadingPlaceholder?: string;
  errorPlaceholder?: string;
  // Same fallback-to-English treatment as above, for the paste-to-create affordance below. Only
  // ever shown when `types` includes IMAGE (a pasted clipboard image can only become an IMAGE
  // asset) — callers restricted to VIDEO/DOCUMENT/TEXT never see it and don't need to pass these.
  pasteHint?: string;
  pasteError?: string;
  uploadingLabel?: string;
  uploadFailedLabel?: string;
}

// Reused by the screens page (screen-level ASSET streaming mode), the layouts page (zone-level
// asset media mode), and the theme editor (IMAGE/VIDEO/DOCUMENT/TEXT element content) — kept
// translation-agnostic via the `placeholder` prop rather than assuming any one caller's i18n
// namespace.
export function AssetPicker({
  value, onChange, placeholder, disabled, types = ['IMAGE', 'VIDEO', 'DOCUMENT'],
  loadingPlaceholder = 'Loading assets…', errorPlaceholder = 'Failed to load assets',
  pasteHint = 'Click here, then press Ctrl+V (⌘V on Mac) to paste an image',
  pasteError = "Clipboard didn't contain an image",
  uploadingLabel = 'Uploading…', uploadFailedLabel = 'Upload failed',
}: AssetPickerProps) {
  const qc = useQueryClient();
  // Previously discarded isLoading/isError, so a slow or failed request looked identical to "no
  // assets exist yet" — the placeholder option below now says which one it actually is.
  const { data: assets = [], isLoading, isError } = useQuery({ queryKey: ['assets'], queryFn: assetsApi.list });
  // No server-side type/status filter exists on GET /assets — filter here to only what's
  // actually playable standalone (images/videos that finished processing). The current `value`
  // is exempt from the READY gate: a freshly pasted/uploaded asset starts out PROCESSING (only
  // its thumbnail generation is async — the file itself is already stored), so without this the
  // picker would show its own just-picked selection as "— No asset —" until a later refetch
  // happens to catch it turning READY. Same workaround ImagePicker applies for its preview.
  const options = assets.filter(a => (types as string[]).includes(a.type) && (a.status === 'READY' || a.id === value));

  // Lets any AssetPicker restricted to (or including) IMAGE double as a paste target — the same
  // clipboard-to-asset shortcut ImagePicker already offers for theme IMAGE elements, but without
  // needing the full existing/upload/paste tab UI ImagePicker uses: this is a single-line hint
  // below the select, since AssetPicker is used in denser contexts (zone property rows, screen
  // table cells) that a multi-tab picker wouldn't fit well.
  const canPaste = (types as string[]).includes('IMAGE');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [pasteErrorMsg, setPasteErrorMsg] = useState('');

  async function uploadPastedBlob(blob: Blob) {
    setPasteErrorMsg('');
    setBusy(true);
    setProgress(0);
    const ext = blob.type.split('/')[1] ?? 'png';
    try {
      const asset = await assetsApi.upload(new File([blob], `pasted-${Date.now()}.${ext}`, { type: blob.type }), setProgress);
      void qc.invalidateQueries({ queryKey: ['assets'] });
      onChange(asset.id);
    } catch (err) {
      setPasteErrorMsg(err instanceof Error ? err.message : uploadFailedLabel);
    } finally {
      setBusy(false);
      setProgress(0);
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    const item = Array.from(e.clipboardData.items).find(i => i.type.startsWith('image/'));
    if (!item) {
      setPasteErrorMsg(pasteError);
      return;
    }
    const blob = item.getAsFile();
    if (!blob) return;
    void uploadPastedBlob(blob);
  }

  return (
    <div onPaste={canPaste && !disabled ? handlePaste : undefined}>
      <AssetSelect
        assets={options}
        value={value}
        onChange={onChange}
        disabled={disabled || isLoading}
        placeholder={isError ? errorPlaceholder : isLoading ? loadingPlaceholder : placeholder}
      />
      {canPaste && !disabled && (
        <p className="mt-1 flex items-center gap-1 text-[10px] text-gray-400 dark:text-gray-500">
          {busy ? (
            <>
              <RefreshCw className="h-2.5 w-2.5 animate-spin shrink-0" /> {uploadingLabel} {progress}%
            </>
          ) : (
            <>
              <Clipboard className="h-2.5 w-2.5 shrink-0" /> {pasteHint}
            </>
          )}
        </p>
      )}
      {pasteErrorMsg && <p className="mt-1 text-[10px] text-red-500">{pasteErrorMsg}</p>}
    </div>
  );
}
