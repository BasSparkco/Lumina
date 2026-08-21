'use client';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { BarChart3, ChevronLeft, ChevronRight, Download, Users2 } from 'lucide-react';
import { screensApi, assetsApi, playlistsApi, kioskAnalyticsApi, type Screen } from '@/lib/api';
import { proofOfPlayApi, type ProofOfPlayEntry } from '@/lib/mocks/proofOfPlay';
import { downloadCsv } from '@/lib/csv';
import { useDateFormat, formatDateTime } from '@/hooks/useDateFormat';
import { PreviewFeatureNotice } from '@/components/PreviewFeatureNotice';

const PAGE_SIZE = 10;
const CHART_HEIGHT_PX = 100;

function ProofOfPlayTab({ screens }: { screens: Screen[] }) {
  const t = useTranslations('reports');
  const { format: dateFormat } = useDateFormat();

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
      filtered.map(e => [formatDateTime(e.playedAt, dateFormat), e.screenName, e.assetName, e.playlistName, e.durationSecs]),
    );
  }

  return (
    <div>
      <PreviewFeatureNotice />

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
                    {formatDateTime(entry.playedAt, dateFormat)}
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

// Kiosk analytics (7.4) — extends this same reports page/pattern (screen filter, date range,
// chart + table) with wayfinding-specific aggregates, rather than a separate analytics page. All
// aggregation happens client-side over the raw event list, same as ProofOfPlayTab above.
function KioskActivityTab({ screens }: { screens: Screen[] }) {
  const t = useTranslations('reports');
  const { format: dateFormat } = useDateFormat();

  const [screenId, setScreenId] = useState<string>('ALL');
  const [fromDate, setFromDate] = useState('');
  const [untilDate, setUntilDate] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['kioskEvents', screenId, fromDate, untilDate],
    queryFn: () => kioskAnalyticsApi.list({
      screenId: screenId === 'ALL' ? undefined : screenId,
      from: fromDate || undefined,
      to: untilDate || undefined,
    }),
  });
  // Memoized so this stays referentially stable across renders where `data` hasn't changed —
  // otherwise `data?.items ?? []` would hand the useMemos below a fresh array every render and
  // they'd recompute for no reason.
  const events = useMemo(() => data?.items ?? [], [data]);
  // The endpoint caps how many events one request returns (see KioskEventsResult) — when the
  // real count exceeds what came back, topSearches/topDestinations below are only aggregating
  // over the most recent slice, not the full filtered range, so this needs to be visible rather
  // than silently rendering an incomplete ranking.
  const truncated = (data?.total ?? 0) > events.length;

  const sessionCount = useMemo(() => events.filter(e => e.type === 'SESSION_START').length, [events]);

  const topSearches = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of events) if (e.type === 'SEARCH' && e.query) map.set(e.query, (map.get(e.query) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  }, [events]);

  const topDestinations = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of events) if (e.type === 'POI_VIEW' && e.poiName) map.set(e.poiName, (map.get(e.poiName) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  }, [events]);

  const maxSearch = Math.max(1, ...topSearches.map(([, c]) => c));
  const maxDestination = Math.max(1, ...topDestinations.map(([, c]) => c));

  function exportCsv() {
    downloadCsv(
      `kiosk-activity-${new Date().toISOString().slice(0, 10)}.csv`,
      [t('time'), t('screenColumn'), t('building'), 'Type', t('searchTerm'), t('destination')],
      events.map(e => [formatDateTime(e.createdAt, dateFormat), e.screenName, e.buildingName ?? '—', e.type, e.query ?? '', e.poiName ?? '']),
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3 mb-6">
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">{t('screen')}</label>
          <select value={screenId} onChange={e => setScreenId(e.target.value)}
            className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option value="ALL">{t('allScreens')}</option>
            {screens.filter(s => s.streamingType === 'WAYFINDING').map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">{t('fromDate')}</label>
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
            className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">{t('untilDate')}</label>
          <input type="date" value={untilDate} onChange={e => setUntilDate(e.target.value)}
            className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <span className="text-xs text-gray-400 dark:text-gray-500 pb-2">{t('sessionCount', { count: sessionCount })}</span>
        <button onClick={exportCsv} disabled={events.length === 0}
          className="ms-auto flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
          <Download className="w-4 h-4" /> {t('exportCsv')}
        </button>
      </div>

      {isLoading && <p className="text-sm text-gray-400">{t('kioskLoading')}</p>}

      {!isLoading && truncated && (
        <div className="mb-4 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-lg px-3 py-2">
          {t('truncatedWarning', { shown: events.length, total: data?.total ?? 0 })}
        </div>
      )}

      {!isLoading && events.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <Users2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{t('kioskEmpty')}</p>
        </div>
      )}

      {!isLoading && events.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-3">{t('topSearches')}</p>
            {topSearches.length === 0 ? (
              <p className="text-xs text-gray-400 dark:text-gray-500">{t('noSearches')}</p>
            ) : (
              <div className="space-y-2">
                {topSearches.map(([query, count]) => (
                  <div key={query} className="flex items-center gap-2 text-xs">
                    <span className="w-28 truncate text-gray-600 dark:text-gray-300 shrink-0">{query}</span>
                    <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded h-3 overflow-hidden">
                      <div className="h-full bg-indigo-500 dark:bg-indigo-600" style={{ width: `${(count / maxSearch) * 100}%` }} />
                    </div>
                    <span className="w-8 text-end text-gray-400 dark:text-gray-500 shrink-0">{count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-3">{t('topDestinations')}</p>
            {topDestinations.length === 0 ? (
              <p className="text-xs text-gray-400 dark:text-gray-500">{t('noDestinations')}</p>
            ) : (
              <div className="space-y-2">
                {topDestinations.map(([name, count]) => (
                  <div key={name} className="flex items-center gap-2 text-xs">
                    <span className="w-28 truncate text-gray-600 dark:text-gray-300 shrink-0">{name}</span>
                    <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded h-3 overflow-hidden">
                      <div className="h-full bg-emerald-500 dark:bg-emerald-600" style={{ width: `${(count / maxDestination) * 100}%` }} />
                    </div>
                    <span className="w-8 text-end text-gray-400 dark:text-gray-500 shrink-0">{count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ReportsPage() {
  const t = useTranslations('reports');
  const { data: screens = [] } = useQuery({ queryKey: ['screens'], queryFn: screensApi.list });
  const hasKiosks = screens.some(s => s.streamingType === 'WAYFINDING');
  const [tab, setTab] = useState<'proofOfPlay' | 'kiosk'>('proofOfPlay');

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('title')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('subtitle')}</p>
      </div>

      {hasKiosks && (
        <div className="flex gap-1 mb-6 border-b border-gray-200 dark:border-gray-800">
          <button
            onClick={() => setTab('proofOfPlay')}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === 'proofOfPlay'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            {t('tabProofOfPlay')}
          </button>
          <button
            onClick={() => setTab('kiosk')}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === 'kiosk'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            {t('tabKioskActivity')}
          </button>
        </div>
      )}

      {tab === 'proofOfPlay' || !hasKiosks ? <ProofOfPlayTab screens={screens} /> : <KioskActivityTab screens={screens} />}
    </div>
  );
}
