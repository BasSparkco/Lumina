'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { X, Sparkles, Shuffle, ImageIcon, Film, FileText } from 'lucide-react';
import { playlistsApi, TRANSITION_STYLE_OPTIONS, TRANSITION_LABEL_KEYS, type AssetType, type ScaleFitMode, type TransitionStyle, type PlaybackOrder } from '@/lib/api';

interface PlaylistSettingsModalProps {
  id: string;
  name: string;
  canEdit: boolean;
  onClose: () => void;
}

// Only asset types the player actually applies an objectFit-style frame to (see ZonePlayer.tsx —
// IMAGE/VIDEO/DOCUMENT are the only kinds rendered with an <img>/<video>/pager `objectFit`;
// AUDIO has no visual, TEXT/APP render their own content with no frame-fit concept). Order here
// is the display order in the modal.
const SCALABLE_TYPES: { type: AssetType; icon: React.ReactNode }[] = [
  { type: 'IMAGE', icon: <ImageIcon className="w-3.5 h-3.5 text-blue-500" /> },
  { type: 'VIDEO', icon: <Film className="w-3.5 h-3.5 text-purple-500" /> },
  { type: 'DOCUMENT', icon: <FileText className="w-3.5 h-3.5 text-red-500" /> },
];

const FIT_MODES: ScaleFitMode[] = ['contain', 'cover', 'fill'];

export function PlaylistSettingsModal({ id, name, canEdit, onClose }: PlaylistSettingsModalProps) {
  const t = useTranslations('playlistSettings');
  const td = useTranslations('playlistDetail');
  const qc = useQueryClient();

  // Shares the ['playlist', id] query key with PlaylistDetail so both stay in sync whether or
  // not this playlist's row happens to also be expanded right now.
  const { data: playlist, isLoading, isError: loadFailed } = useQuery({ queryKey: ['playlist', id], queryFn: () => playlistsApi.get(id) });

  const configMut = useMutation({
    mutationFn: (config: {
      transitionStyle?: TransitionStyle; transitionDurationMs?: number; playbackOrder?: PlaybackOrder;
      scaleSettings?: Partial<Record<AssetType, ScaleFitMode>>;
    }) => playlistsApi.updateConfig(id, config),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['playlist', id] });
    },
  });

  function setScale(type: AssetType, mode: ScaleFitMode | '') {
    const current = playlist?.scaleSettings ?? {};
    const next = { ...current };
    if (mode) next[type] = mode; else delete next[type];
    configMut.mutate({ scaleSettings: next });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6" onClick={onClose}>
      <div
        className="w-full max-w-md max-h-full overflow-y-auto rounded-xl bg-white p-5 dark:bg-gray-900"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-6 mb-4">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{t('title', { name })}</p>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 shrink-0">
            <X className="h-5 w-5" />
          </button>
        </div>

        {isLoading && <p className="text-sm text-gray-400 py-6 text-center">{td('loading')}</p>}
        {loadFailed && <p className="text-sm text-red-500 py-6 text-center">{td('notFound')}</p>}

        {playlist && (
          <div className="space-y-5">
            {configMut.isError && (
              <p className="text-xs text-red-500">{(configMut.error as Error).message}</p>
            )}
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-2">
                {t('scaleSettings.heading')}
              </h3>
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">{t('scaleSettings.description')}</p>
              <div className="space-y-2">
                {SCALABLE_TYPES.map(({ type, icon }) => (
                  <div key={type} className="flex items-center gap-2">
                    {icon}
                    <label className="flex-1 text-xs text-gray-600 dark:text-gray-300">
                      {t(`scaleSettings.types.${type}`)}
                    </label>
                    <select
                      value={playlist.scaleSettings?.[type] ?? ''}
                      disabled={!canEdit || configMut.isPending}
                      onChange={e => setScale(type, e.target.value as ScaleFitMode | '')}
                      className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                    >
                      <option value="">{t('scaleSettings.default')}</option>
                      {FIT_MODES.map(mode => (
                        <option key={mode} value={mode}>{t(`scaleSettings.modes.${mode}`)}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-2">
                {t('transition.heading')}
              </h3>
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 shrink-0" />
                  <label className="text-xs text-gray-500 dark:text-gray-400">{td('transition.label')}</label>
                  <select value={playlist.transitionStyle} disabled={!canEdit || configMut.isPending}
                    onChange={e => configMut.mutate({ transitionStyle: e.target.value as TransitionStyle })}
                    className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50">
                    {TRANSITION_STYLE_OPTIONS.map(id => (
                      <option key={id} value={id}>{td(`transition.${TRANSITION_LABEL_KEYS[id]}`)}</option>
                    ))}
                  </select>
                  {playlist.transitionStyle !== 'NONE' && (
                    <>
                      <input type="number" min={100} max={3000} step={100} value={playlist.transitionDurationMs}
                        disabled={!canEdit || configMut.isPending}
                        onChange={e => configMut.mutate({ transitionDurationMs: Math.min(3000, Math.max(100, Number(e.target.value) || 100)) })}
                        className="w-20 border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1 text-xs text-center focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50" />
                      <span className="text-xs text-gray-400 dark:text-gray-500">{td('transition.ms')}</span>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Shuffle className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 shrink-0" />
                  <label className="text-xs text-gray-500 dark:text-gray-400">{td('playbackOrder.label')}</label>
                  <select value={playlist.playbackOrder} disabled={!canEdit || configMut.isPending}
                    onChange={e => configMut.mutate({ playbackOrder: e.target.value as PlaybackOrder })}
                    className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50">
                    <option value="SEQUENTIAL">{td('playbackOrder.sequential')}</option>
                    <option value="SHUFFLE">{td('playbackOrder.shuffle')}</option>
                  </select>
                </div>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
