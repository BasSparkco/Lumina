'use client';
import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AssetSelect } from '@/components/AssetSelect';
import { assetsApi, type Asset } from '@/lib/api';
import { MediaInsertionError, prepareMedia, type MediaKind, type ReadyMedia } from '../lib/mediaInsertion';

export function MediaInsertDialog({ kind, onInsert, onClose }: {
  kind: MediaKind;
  onInsert: (media: ReadyMedia) => void;
  onClose: () => void;
}) {
  const t = useTranslations('designer2Media');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const { data: assets = [], isLoading, isError, refetch } = useQuery({ queryKey: ['assets'], queryFn: assetsApi.list });
  const [mode, setMode] = useState<'assets' | 'upload'>('assets');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const latestInsert = useRef(onInsert);
  useEffect(() => { latestInsert.current = onInsert; }, [onInsert]);
  const requestRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current!;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    return () => {
      requestRef.current?.abort();
      dialog.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  function close() {
    requestRef.current?.abort();
    onClose();
  }

  async function select(id?: string, file?: File) {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setBusy(true);
    setError('');
    setProgress(file ? 0 : null);
    try {
      if (file) {
        if (!file.type.startsWith(kind === 'IMAGE' ? 'image/' : 'video/')) throw new MediaInsertionError('wrongType');
        const uploaded = await assetsApi.upload(file, (value) => {
          if (!controller.signal.aborted) setProgress(value);
        }, controller.signal);
        controller.signal.throwIfAborted();
        id = uploaded.id;
        setProgress(null);
      }
      if (!id) return;
      const media = await prepareMedia(id, kind, controller.signal);
      controller.signal.throwIfAborted();
      // Prime the same tenant Asset query used by the viewport before committing the element,
      // so its first projection can resolve the real media URL immediately.
      queryClient.setQueryData<Asset[]>(['assets'], (previous = []) =>
        [...previous.filter((asset) => asset.id !== media.asset.id), media.asset]);
      latestInsert.current(media);
    } catch (cause) {
      if (!controller.signal.aborted) setError(t(cause instanceof MediaInsertionError ? cause.code : 'failed'));
    } finally {
      if (!controller.signal.aborted) { setBusy(false); setProgress(null); }
    }
  }

  const button = 'rounded-md border border-[var(--deck-glass-border)] px-3 py-2 text-sm disabled:opacity-50';
  return (
    <dialog ref={dialogRef} dir={locale === 'ar' ? 'rtl' : 'ltr'} aria-labelledby="media-insert-title"
      className="command-deck glass-panel m-auto w-[min(32rem,90vw)] max-h-[85vh] overflow-y-auto rounded-2xl p-5 text-[var(--deck-text-hi)] backdrop:bg-black/50"
      onCancel={(event) => { event.preventDefault(); close(); }}
      onKeyDown={(event) => event.stopPropagation()}>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 id="media-insert-title" className="text-lg font-semibold">{t(kind === 'IMAGE' ? 'imageTitle' : 'videoTitle')}</h2>
        <button type="button" className={button} onClick={close}>{t('cancel')}</button>
      </div>
      <div className="mb-4 flex gap-2">
        <button type="button" className={button} aria-pressed={mode === 'upload'} disabled={busy} onClick={() => setMode('upload')}>{t('upload')}</button>
        <button type="button" className={button} aria-pressed={mode === 'assets'} disabled={busy} onClick={() => setMode('assets')}>{t('assets')}</button>
      </div>
      {mode === 'assets' ? (
        isLoading ? <p role="status">{t('loading')}</p> : isError ? (
          <div role="alert"><p>{t('failed')}</p><button className={button} onClick={() => void refetch()}>{t('retry')}</button></div>
        ) : <AssetSelect assets={assets.filter((asset) => asset.type === kind && asset.status === 'READY')}
          value={null} onChange={(id) => { if (id) void select(id); }} disabled={busy}
          placeholder={t('choose')} searchPlaceholder={t('search')} emptyLabel={t('empty')} />
      ) : (
        <div>
          <button type="button" className={`${button} w-full border-dashed`} disabled={busy} onClick={() => fileRef.current?.click()}>{t('chooseFile')}</button>
          <input ref={fileRef} aria-label={t('chooseFile')} type="file" className="hidden" accept={kind === 'IMAGE' ? 'image/*' : 'video/*'}
            onChange={(event) => { const file = event.target.files?.[0]; if (file) void select(undefined, file); event.target.value = ''; }} />
        </div>
      )}
      {busy && <p role="status" className="mt-3 text-sm">{progress === null ? t('preparing') : t('uploading', { progress })}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-red-500">{error}</p>}
    </dialog>
  );
}
