'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Activity, AlertTriangle, Tv2, List, ImageIcon, HardDrive } from 'lucide-react';
import { screensApi, assetsApi, playlistsApi, type Screen } from '@/lib/api';
import { getUptimePercents } from '@/lib/mocks/uptime';
import { useScreenSocket } from '@/hooks/useScreenSocket';
import { useDateFormat, formatDateTime } from '@/hooks/useDateFormat';

// A screen is only truly "ONLINE" if it has heartbeated recently — the backend currently never
// pushes an OFFLINE status over the socket on disconnect (only ever pushes ONLINE from the
// heartbeat handler), so trusting the stored/pushed status alone would show a screen as ONLINE
// forever after its last heartbeat. 5 minutes gives ~10 missed 30s heartbeats of buffer before
// flagging a screen, so a brief network blip doesn't false-positive.
const OFFLINE_THRESHOLD_MS = 5 * 60 * 1000;
const CRASH_LOOP_THRESHOLD = 3;

function msSince(iso: string, now: number): number {
  return now - new Date(iso).getTime();
}

function formatDuration(ms: number): string {
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(1)} GB`;
}

export default function DashboardPage() {
  const t = useTranslations('fleet');
  const ts = useTranslations('screens');
  const liveStatuses = useScreenSocket();
  const { format: dateFormat } = useDateFormat();

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const { data: screens = [], isLoading: screensLoading } = useQuery({ queryKey: ['screens'], queryFn: screensApi.list });
  const { data: assets = [] } = useQuery({ queryKey: ['assets'], queryFn: assetsApi.list });
  const { data: playlists = [] } = useQuery({ queryKey: ['playlists'], queryFn: playlistsApi.list });
  const { data: fleetStatus } = useQuery({ queryKey: ['fleetStatus'], queryFn: screensApi.fleetStatus });

  const uptimeByScreen = useMemo(() => getUptimePercents(screens.map((s: Screen) => s.id)), [screens]);
  const crashCountByScreen = useMemo(
    () => Object.fromEntries((fleetStatus?.screens ?? []).map(s => [s.id, s.crashCount7d])),
    [fleetStatus],
  );

  function effectiveStatus(screen: Screen): 'ONLINE' | 'OFFLINE' {
    if (!screen.lastSeenAt || msSince(screen.lastSeenAt, now) > OFFLINE_THRESHOLD_MS) return 'OFFLINE';
    return liveStatuses[screen.id] ?? screen.status;
  }

  const rows = screens.map((screen: Screen) => ({ screen, status: effectiveStatus(screen) }));
  const onlineCount = rows.filter(r => r.status === 'ONLINE').length;
  const offlineRows = rows.filter(r => r.status === 'OFFLINE');
  const avgUptime = screens.length > 0
    ? Math.round((screens.reduce((sum: number, s: Screen) => sum + (uptimeByScreen[s.id] ?? 0), 0) / screens.length) * 10) / 10
    : 0;
  const totalStorageBytes = assets.reduce((sum, a) => sum + a.sizeBytes, 0);
  const screensWithCrashes = Object.values(crashCountByScreen).filter(c => c > 0).length;

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('title')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('subtitle')}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-4">
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">{t('totalScreens')}</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{screens.length}</p>
        </div>
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">{ts('online')}</p>
          <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{onlineCount}</p>
        </div>
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">{ts('offline')}</p>
          <p className="text-2xl font-bold text-red-600 dark:text-red-400">{offlineRows.length}</p>
        </div>
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">{t('avgUptime')}</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{avgUptime}%</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-1 flex items-center gap-1.5"><List className="w-3.5 h-3.5" /> {t('totalPlaylists')}</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{playlists.length}</p>
        </div>
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-1 flex items-center gap-1.5"><ImageIcon className="w-3.5 h-3.5" /> {t('totalAssets')}</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{assets.length}</p>
        </div>
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-1 flex items-center gap-1.5"><HardDrive className="w-3.5 h-3.5" /> {t('storageUsed')}</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{formatBytes(totalStorageBytes)}</p>
        </div>
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-1 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> {t('screensWithCrashes')}</p>
          <p className={`text-2xl font-bold ${screensWithCrashes > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-900 dark:text-gray-100'}`}>{screensWithCrashes}</p>
        </div>
      </div>

      {offlineRows.length > 0 && (
        <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 text-sm px-4 py-2.5 rounded-lg mb-6">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {t('offlineAlert', { count: offlineRows.length })}
        </div>
      )}

      {screensLoading && <p className="text-sm text-gray-400">{t('loading')}</p>}

      {!screensLoading && screens.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <Activity className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{t('empty')}</p>
        </div>
      )}

      {!screensLoading && screens.length > 0 && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-800 text-start text-xs text-gray-400 dark:text-gray-500">
                <th className="text-start font-medium px-4 py-2.5">{t('screen')}</th>
                <th className="text-start font-medium px-4 py-2.5">{t('status')}</th>
                <th className="text-start font-medium px-4 py-2.5">{t('lastSeenColumn')}</th>
                <th className="text-start font-medium px-4 py-2.5">{t('uptime')}</th>
                <th className="text-start font-medium px-4 py-2.5">{t('crashes7d')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
              {rows.map(({ screen, status }) => (
                <tr key={screen.id}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5 text-gray-900 dark:text-gray-100">
                      <Tv2 className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 shrink-0" />
                      {screen.name}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${status === 'ONLINE' ? 'bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-400' : 'bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-400'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${status === 'ONLINE' ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
                      {status === 'ONLINE' ? ts('online') : ts('offline')}
                    </span>
                    {status === 'OFFLINE' && screen.lastSeenAt && (
                      <span className="ms-2 text-xs text-red-500 dark:text-red-400">
                        {t('offlineFor', { duration: formatDuration(msSince(screen.lastSeenAt, now)) })}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {screen.lastSeenAt ? formatDateTime(screen.lastSeenAt, dateFormat) : ts('neverSeen')}
                  </td>
                  <td className="px-4 py-2.5 text-gray-700 dark:text-gray-300">{uptimeByScreen[screen.id] ?? 0}%</td>
                  <td className="px-4 py-2.5">
                    {(crashCountByScreen[screen.id] ?? 0) > 0 ? (
                      <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${
                        (crashCountByScreen[screen.id] ?? 0) >= CRASH_LOOP_THRESHOLD
                          ? 'bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-400'
                          : 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-400'
                      }`}>
                        {(crashCountByScreen[screen.id] ?? 0) >= CRASH_LOOP_THRESHOLD && <AlertTriangle className="w-3 h-3" />}
                        {crashCountByScreen[screen.id]}
                      </span>
                    ) : (
                      <span className="text-gray-300 dark:text-gray-600">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
