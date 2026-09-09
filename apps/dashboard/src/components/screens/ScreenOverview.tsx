'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { LivePlaybackProgress } from '@/hooks/useScreenSocket';
import { useLocale, useTranslations } from 'next-intl';
import { GripVertical, ChevronRight, Monitor, Radio, CircleAlert } from 'lucide-react';
import type { Screen, ScreenGroup, Asset } from '@/lib/api';
import { formatDateTime, type DateFormat } from '@/hooks/useDateFormat';

export function ScreenSummary({
  screens,
  statusFor,
}: {
  screens: Screen[];
  statusFor: (screen: Screen) => Screen['status'];
}) {
  const t = useTranslations('screens.overview');
  const locale = useLocale();
  const online = screens.filter(
    (screen) => statusFor(screen) === 'ONLINE',
  ).length;
  const stats = [
    { key: 'total', count: screens.length, Icon: Monitor },
    { key: 'online', count: online, Icon: Radio },
    { key: 'offline', count: screens.length - online, Icon: CircleAlert },
  ];
  return (
    <div className="signal-screen-summary">
      {stats.map(({ key, count, Icon }) => (
        <div key={key}>
          <span className={`signal-summary-icon ${key}`}>
            <Icon size={21} />
          </span>
          <div>
            <span>{t(key)}</span>
            <strong>{new Intl.NumberFormat(locale).format(count)}</strong>
          </div>
        </div>
      ))}
    </div>
  );
}

function SortableRow({ id, disabled, children }: {
  id: string; disabled: boolean; children: (handle: ReactNode) => ReactNode;
}) {
  const t = useTranslations('screens');
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  return <tr ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, position: 'relative', zIndex: isDragging ? 1 : undefined, opacity: isDragging ? 0.6 : 1 }}>
    {children(disabled ? null : <button className="signal-screen-drag" type="button" {...attributes} {...listeners} aria-label={t('dragToReorder')}><GripVertical size={16} /></button>)}
  </tr>;
}

function clockTime(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

export function PlayerStatus({ screen, status, progress, now }: {
  screen: Screen; status: Screen['status']; progress?: LivePlaybackProgress; now: number;
}) {
  const t = useTranslations('screens.overview');
  const ts = useTranslations('screens');
  const fresh = progress && now - progress.receivedAt < 10000;
  const available = status === 'ONLINE' && !screen.stopped && !screen.emergencyActive && screen.streamingType === 'ASSET' && fresh;
  const label = screen.emergencyActive ? ts('emergency') : screen.stopped ? ts('stoppedBanner') : status !== 'ONLINE' ? t('playerOffline') : !available ? t('playerUnknown') : progress.paused ? t('playerPaused') : progress.advancing ? t('playerPlaying') : t('playerWaiting');
  return <div className="signal-player-state">
    <strong>{label}</strong>
    {available ? <><small dir="ltr">{clockTime(progress.currentTime)} / {clockTime(progress.duration)}</small><progress aria-label={t('playerProgress')} max={progress.duration} value={Math.min(progress.currentTime, progress.duration)} /></> : <small>{t('playerUnconfirmed')}</small>}
  </div>;
}

export function ScreenOverview({
  screens,
  groups,
  assets,
  playlists,
  statusFor,
  dateFormat,
  onManage,
  canReorder = false,
  playbackProgress = {},
}: {
  screens: Screen[];
  groups: ScreenGroup[];
  assets: Asset[];
  playlists: { id: string; name: string }[];
  statusFor: (screen: Screen) => Screen['status'];
  dateFormat: DateFormat;
  onManage: (screen: Screen) => void;
  canReorder?: boolean;
  playbackProgress?: Record<string, LivePlaybackProgress>;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const t = useTranslations('screens');
  const to = useTranslations('screens.overview');
  return (
    <div className="signal-screen-list">
      <table>
        <caption className="sr-only">{to('caption')}</caption>
        <thead>
          <tr>
            <th scope="col">{to('screen')}</th>
            <th scope="col">{to('content')}</th>
            <th scope="col">{to('player')}</th>
            <th scope="col">{to('lastSeen')}</th>
            <th scope="col">
              <span className="sr-only">{to('actions')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {screens.map((screen) => {
            const status = statusFor(screen);
            const group = groups.find((item) => item.id === screen.groupId);
            const asset = assets.find((item) => item.id === screen.assetId);
            const content =
              screen.streamingType === 'PLAYLIST'
                ? (screen.playlist?.name ??
                  playlists.find((item) => item.id === screen.playlistId)
                    ?.name ??
                  to(screen.playlistId ? 'unavailableContent' : 'unassigned'))
                : screen.streamingType === 'ASSET'
                  ? (asset?.name ??
                    to(screen.assetId ? 'unavailableContent' : 'unassigned'))
                  : t(`streamingType.${screen.streamingType}`);
            return (
              <SortableRow key={screen.id} id={screen.id} disabled={!canReorder}>{handle => <>
                <td className="signal-screen-identity"><div className="signal-screen-identity-inner">{handle}
                  <button type="button" onClick={() => onManage(screen)}>
                    <span className={`signal-screen-icon ${status === 'ONLINE' ? 'online' : 'offline'}`} role="img" aria-label={to(status === 'ONLINE' ? 'online' : 'offline')} title={to(status === 'ONLINE' ? 'online' : 'offline')}>
                      <Monitor size={23} />
                    </span>
                    <span>
                      <strong>{screen.name}</strong>
                      <small>{group?.name ?? to('ungrouped')}</small>
                    </span>
                  </button></div>
                </td>
                <td className="signal-screen-content">
                  <strong>{content}</strong>
                  <small>
                    {t(`streamingType.${screen.streamingType}`)} ·{' '}
                    <bdi>{screen.aspectRatio}</bdi>
                  </small>
                </td>
                <td className="signal-screen-player"><PlayerStatus screen={screen} status={status} progress={playbackProgress[screen.id]} now={now} /></td>
                <td className="signal-screen-seen">
                  <span className="signal-mobile-label">
                    {to('lastSeen')}:{' '}
                  </span>
                  {screen.lastSeenAt ? (
                    <time dir="ltr" dateTime={screen.lastSeenAt}>
                      {formatDateTime(screen.lastSeenAt, dateFormat)}
                    </time>
                  ) : (
                    t('neverSeen')
                  )}
                </td>
                <td className="signal-screen-action">
                  <button
                    type="button"
                    onClick={() => onManage(screen)}
                    aria-label={to('manageScreen', { name: screen.name })}
                  >
                    {to('manage')}
                    <ChevronRight size={16} className="signal-chevron" />
                  </button>
                </td>
              </>}</SortableRow>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
