'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { BarChart3, Activity, ChevronLeft, ChevronRight, Download, Tv2, AlertTriangle } from 'lucide-react';
import { screensApi, assetsApi, playlistsApi, type Screen } from '@/lib/api';
import { proofOfPlayApi, type ProofOfPlayEntry } from '@/lib/mocks/proofOfPlay';
import { getUptimePercents } from '@/lib/mocks/uptime';
import { useScreenSocket } from '@/hooks/useScreenSocket';
import { downloadCsv } from '@/lib/csv';

const PAGE_SIZE = 10;
const CHART_HEIGHT_PX = 100;

// A screen is only truly "ONLINE" if it has heartbeated recently — the backend currently never
// pushes an OFFLINE status over the socket on disconnect (only ever pushes ONLINE from the
// heartbeat handler), so trusting the stored/pushed status alone would show a screen as ONLINE
// forever after its last heartbeat. 5 minutes gives ~10 missed 30s heartbeats of buffer before
// flagging a screen, so a brief network blip doesn't false-positive.
const OFFLINE_THRESHOLD_MS = 5 * 60 * 1000;

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

function ProofOfPlayTab({ screens }: { screens: Screen[] }) {
  const t = useTranslations('reports');

  const [screenId, setScreenId] = useState<string>('ALL');
  const [fromDate, setFromDate] = useState('');
  const [untilDate, setUntilDate] = useState('');
  const [page, setPage] = useState(1);

  const { data: assets = [], isLoading: assetsLoading } = useQuery({ queryKey: ['assets'], queryFn: assetsApi.list });
  const { data: playlists = [], isLoading: playlistsLoading } = useQuery({ queryKey: ['playlists'], queryFn: playlistsApi.list });

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['proofOfPlay'],
    queryFn: () => proofOfPlayApi.list(screens, assets, playlists),
    // Wait for screens/assets/playlists to actually finish loading (not just for screens to be
    // non-empty) before generating the mock seed — otherwise this can fire while assets/playlists
    // are still at their query-default `[]`, permanently caching an empty history in localStorage.
    enabled: screens.length > 0 && !assetsLoading && !playlistsLoading,
  });

  const filtered = useMemo(() => entries.filter((e: ProofOfPlayEntry) => {
    if (screenId !== 'ALL' && e.screenId !== screenId) return false;
    const day = e.playedAt.substring(0, 10);
    if (fromDate && day < fromDate) return false;
    if (untilDate && day > untilDate) return false;
    return true;
  }), [entries, screenId, fromDate, untilDate]);

  const playsPerDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of filtered) {
      const day = e.playedAt.substring(0, 10);
      map.set(day, (map.get(day) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const playsPerScreen = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of filtered) map.set(e.screenName, (map.get(e.screenName) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  const maxPerDay = Math.max(1, ...playsPerDay.map(([, c]) => c));
  const maxPerScreen = Math.max(1, ...playsPerScreen.map(([, c]) => c));

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function exportCsv() {
    downloadCsv(
      `proof-of-play-${new Date().toISOString().slice(0, 10)}.csv`,
      [t('time'), t('screenColumn'), t('asset'), t('playlist'), t('duration')],
      filtered.map(e => [new Date(e.playedAt).toLocaleString(), e.screenName, e.assetName, e.playlistName, e.durationSecs]),
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3 mb-6">
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">{t('screen')}</label>
          <select value={screenId} onChange={e => { setScreenId(e.target.value); setPage(1); }}
            className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option value="ALL">{t('allScreens')}</option>
            {screens.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">{t('fromDate')}</label>
          <input type="date" value={fromDate} onChange={e => { setFromDate(e.target.value); setPage(1); }}
            className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">{t('untilDate')}</label>
          <input type="date" value={untilDate} onChange={e => { setUntilDate(e.target.value); setPage(1); }}
            className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <span className="text-xs text-gray-400 dark:text-gray-500 pb-2">{t('resultCount', { count: filtered.length })}</span>
        <button onClick={exportCsv} disabled={filtered.length === 0}
          className="ms-auto flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
          <Download className="w-4 h-4" /> {t('exportCsv')}
        </button>
      </div>

      {!isLoading && filtered.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 mb-6">
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-3">{t('playsPerDay')}</p>
            <div className="flex items-end gap-1" style={{ height: CHART_HEIGHT_PX + 20 }}>
              {playsPerDay.map(([day, count]) => (
                <div key={day} className="flex-1 flex flex-col items-center justify-end gap-1 h-full" title={`${day}: ${count}`}>
                  <div className="w-full bg-indigo-500 dark:bg-indigo-600 rounded-t" style={{ height: `${Math.max(4, (count / maxPerDay) * CHART_HEIGHT_PX)}px` }} />
                  <span className="text-[9px] text-gray-400 dark:text-gray-500">{day.slice(5)}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-3">{t('playsPerScreen')}</p>
            <div className="space-y-2">
              {playsPerScreen.map(([name, count]) => (
                <div key={name} className="flex items-center gap-2 text-xs">
                  <span className="w-28 truncate text-gray-600 dark:text-gray-300 shrink-0">{name}</span>
                  <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded h-3 overflow-hidden">
                    <div className="h-full bg-indigo-500 dark:bg-indigo-600" style={{ width: `${(count / maxPerScreen) * 100}%` }} />
                  </div>
                  <span className="w-8 text-end text-gray-400 dark:text-gray-500 shrink-0">{count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {isLoading && <p className="text-sm text-gray-400">{t('loading')}</p>}

      {!isLoading && filtered.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <BarChart3 className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{t('empty')}</p>
        </div>
      )}

      {!isLoading && filtered.length > 0 && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-800 text-start text-xs text-gray-400 dark:text-gray-500">
                <th className="text-start font-medium px-4 py-2.5">{t('time')}</th>
                <th className="text-start font-medium px-4 py-2.5">{t('screenColumn')}</th>
                <th className="text-start font-medium px-4 py-2.5">{t('asset')}</th>
                <th className="text-start font-medium px-4 py-2.5">{t('playlist')}</th>
                <th className="text-start font-medium px-4 py-2.5">{t('duration')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
              {pageItems.map(entry => (
                <tr key={entry.id}>
                  <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {new Date(entry.playedAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-gray-900 dark:text-gray-100">{entry.screenName}</td>
                  <td className="px-4 py-2.5 text-gray-700 dark:text-gray-300">{entry.assetName}</td>
                  <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400">{entry.playlistName || '—'}</td>
                  <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400">{t('durationSec', { seconds: entry.durationSecs })}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-gray-800">
            <span className="text-xs text-gray-400 dark:text-gray-500">{t('pageInfo', { page: currentPage, total: totalPages })}</span>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={currentPage <= 1}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40">
                <ChevronLeft className="w-3.5 h-3.5" /> {t('prev')}
              </button>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40">
                {t('next')} <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FleetTab({ screens, screensLoading }: { screens: Screen[]; screensLoading: boolean }) {
  const t = useTranslations('fleet');
  const ts = useTranslations('screens');
  const liveStatuses = useScreenSocket();

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const uptimeByScreen = useMemo(() => getUptimePercents(screens.map(s => s.id)), [screens]);

  function effectiveStatus(screen: Screen): 'ONLINE' | 'OFFLINE' {
    if (!screen.lastSeenAt || msSince(screen.lastSeenAt, now) > OFFLINE_THRESHOLD_MS) return 'OFFLINE';
    return liveStatuses[screen.id] ?? screen.status;
  }

  const rows = screens.map(screen => ({ screen, status: effectiveStatus(screen) }));
  const onlineCount = rows.filter(r => r.status === 'ONLINE').length;
  const offlineRows = rows.filter(r => r.status === 'OFFLINE');
  const avgUptime = screens.length > 0
    ? Math.round((screens.reduce((sum, s) => sum + (uptimeByScreen[s.id] ?? 0), 0) / screens.length) * 10) / 10
    : 0;

  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-4 mb-6">
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
                    {screen.lastSeenAt ? new Date(screen.lastSeenAt).toLocaleString() : ts('neverSeen')}
                  </td>
                  <td className="px-4 py-2.5 text-gray-700 dark:text-gray-300">{uptimeByScreen[screen.id] ?? 0}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function ReportsPage() {
  const t = useTranslations('reports');
  const [tab, setTab] = useState<'plays' | 'fleet'>('plays');
  const { data: screens = [], isLoading: screensLoading } = useQuery({ queryKey: ['screens'], queryFn: screensApi.list });

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('title')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('subtitle')}</p>
      </div>

      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-800 mb-6">
        <button onClick={() => setTab('plays')}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === 'plays' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
          }`}>
          <BarChart3 className="w-4 h-4" /> {t('tabProofOfPlay')}
        </button>
        <button onClick={() => setTab('fleet')}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === 'fleet' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
          }`}>
          <Activity className="w-4 h-4" /> {t('tabFleet')}
        </button>
      </div>

      {tab === 'plays' ? <ProofOfPlayTab screens={screens} /> : <FleetTab screens={screens} screensLoading={screensLoading} />}
    </div>
  );
}
