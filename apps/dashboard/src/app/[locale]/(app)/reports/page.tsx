'use client';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { BarChart3, ChevronLeft, ChevronRight, Download, Users2 } from 'lucide-react';
import { screensApi, kioskAnalyticsApi, proofOfPlayApi, type Screen } from '@/lib/api';
import { downloadCsv } from '@/lib/csv';
import { useDateFormat, formatDateTime } from '@/hooks/useDateFormat';

const PAGE_SIZE = 25;
const CHART_HEIGHT_PX = 100;
// exportCsv fetches one large unpaged batch rather than reusing the table's own paginated page —
// same cap order of magnitude as the backend's own summary()/exportCsv sampling.
const EXPORT_PAGE_SIZE = 5000;

// P8 (docs/tenant_isolation_and_platform_admin_plan.md) — this used to read a per-browser
// localStorage mock that fabricated a plausible-looking history on first load (see the removed
// lib/mocks/proofOfPlay.ts), since nothing anywhere ever emitted a real play event. It now reads
// apps/api's real GET /proof-of-play (table, server-paginated) and GET /proof-of-play/summary
// (day/screen aggregates, since the table itself no longer holds the full filtered set to
// aggregate over) — populated by apps/player's new buffering/flush pipeline
// (apps/player/src/lib/proofOfPlay.ts), which now actually calls the ingest endpoint that
// existed, unused, all along.
function ProofOfPlayTab({ screens }: { screens: Screen[] }) {
  const t = useTranslations('reports');
  const { format: dateFormat } = useDateFormat();

  const [screenId, setScreenId] = useState<string>('ALL');
  const [fromDate, setFromDate] = useState('');
  const [untilDate, setUntilDate] = useState('');
  const [page, setPage] = useState(1);

  const filterParams = { screenId: screenId === 'ALL' ? undefined : screenId, from: fromDate || undefined, to: untilDate || undefined };

  const { data, isLoading } = useQuery({
    queryKey: ['proofOfPlay', filterParams, page],
    queryFn: () => proofOfPlayApi.list({ ...filterParams, page, pageSize: PAGE_SIZE }),
    placeholderData: (prev) => prev,
  });
  const entries = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const { data: summary } = useQuery({
    queryKey: ['proofOfPlaySummary', filterParams],
    queryFn: () => proofOfPlayApi.summary(filterParams),
  });
  const playsPerDay = summary?.byDay ?? [];
  const playsPerScreen = summary?.byScreen ?? [];
  const maxPerDay = Math.max(1, ...playsPerDay.map((d) => d.count));
  const maxPerScreen = Math.max(1, ...playsPerScreen.map((s) => s.count));

  async function exportCsv() {
    const batch = await proofOfPlayApi.list({ ...filterParams, page: 1, pageSize: EXPORT_PAGE_SIZE });
    downloadCsv(
      `proof-of-play-${new Date().toISOString().slice(0, 10)}.csv`,
      [t('time'), t('screenColumn'), t('asset'), t('duration')],
      batch.items.map(e => [formatDateTime(e.playedAt, dateFormat), e.screen.name, e.asset?.name ?? '—', Math.round(e.durationMs / 1000)]),
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3 mb-6">
        <div>
          <label htmlFor="signal-reports-field-1" className="text-xs text-[var(--deck-text-mid)] mb-1 block">{t('screen')}</label>
          <select id="signal-reports-field-1" value={screenId} onChange={e => { setScreenId(e.target.value); setPage(1); }}
            className="border border-[var(--deck-glass-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--deck-accent)]">
            <option value="ALL">{t('allScreens')}</option>
            {screens.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="signal-reports-field-2" className="text-xs text-[var(--deck-text-mid)] mb-1 block">{t('fromDate')}</label>
          <input id="signal-reports-field-2" type="date" value={fromDate} onChange={e => { setFromDate(e.target.value); setPage(1); }}
            className="border border-[var(--deck-glass-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--deck-accent)]" />
        </div>
        <div>
          <label htmlFor="signal-reports-field-3" className="text-xs text-[var(--deck-text-mid)] mb-1 block">{t('untilDate')}</label>
          <input id="signal-reports-field-3" type="date" value={untilDate} onChange={e => { setUntilDate(e.target.value); setPage(1); }}
            className="border border-[var(--deck-glass-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--deck-accent)]" />
        </div>
        <span className="text-xs text-[var(--deck-text-low)] pb-2">{t('resultCount', { count: total })}</span>
        <button onClick={() => void exportCsv()} disabled={total === 0}
          className="ms-auto flex items-center gap-2 bg-[var(--deck-accent)] text-white px-4 py-2 rounded-lg text-sm font-medium  disabled:opacity-50">
          <Download className="w-4 h-4" /> {t('exportCsv')}
        </button>
      </div>

      {playsPerDay.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 mb-6">
          <div className="glass-panel rounded-2xl p-4">
            <p className="text-xs font-medium text-[var(--deck-text-mid)] mb-3">{t('playsPerDay')}</p>
            <div className="flex items-end gap-1" style={{ height: CHART_HEIGHT_PX + 20 }}>
              {playsPerDay.map(({ day, count }) => (
                <div key={day} className="flex-1 flex flex-col items-center justify-end gap-1 h-full" title={`${day}: ${count}`}>
                  <div className="w-full bg-[var(--deck-accent)] rounded-t" style={{ height: `${Math.max(4, (count / maxPerDay) * CHART_HEIGHT_PX)}px` }} />
                  <span className="text-[9px] text-[var(--deck-text-low)]">{day.slice(5)}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="glass-panel rounded-2xl p-4">
            <p className="text-xs font-medium text-[var(--deck-text-mid)] mb-3">{t('playsPerScreen')}</p>
            <div className="space-y-2">
              {playsPerScreen.map(({ screenId: sId, name, count }) => (
                <div key={sId} className="flex items-center gap-2 text-xs">
                  <span className="w-28 truncate text-[var(--deck-text-mid)] shrink-0">{name}</span>
                  <div className="flex-1 bg-[var(--deck-glass-fill-strong)] rounded h-3 overflow-hidden">
                    <div className="h-full bg-[var(--deck-accent)]" style={{ width: `${(count / maxPerScreen) * 100}%` }} />
                  </div>
                  <span className="w-8 text-end text-[var(--deck-text-low)] shrink-0">{count}</span>
                </div>
              ))}
            </div>
          </div>
          {summary?.truncated && (
            <p className="sm:col-span-2 text-[11px] text-amber-700 dark:text-amber-400">
              {t('summaryTruncated', { count: summary.sampledCount })}
            </p>
          )}
        </div>
      )}

      {isLoading && !data && <p className="text-sm text-[var(--deck-text-low)]">{t('loading')}</p>}

      {!isLoading && entries.length === 0 && (
        <div className="text-center py-16 text-[var(--deck-text-low)]">
          <BarChart3 className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{t('empty')}</p>
        </div>
      )}

      {entries.length > 0 && (
        <div className="glass-panel rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--deck-glass-border-soft)] text-start text-xs text-[var(--deck-text-low)]">
                <th className="text-start font-medium px-4 py-2.5">{t('time')}</th>
                <th className="text-start font-medium px-4 py-2.5">{t('screenColumn')}</th>
                <th className="text-start font-medium px-4 py-2.5">{t('asset')}</th>
                <th className="text-start font-medium px-4 py-2.5">{t('duration')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--deck-glass-border-soft)]">
              {entries.map(entry => (
                <tr key={entry.id}>
                  <td className="px-4 py-2.5 text-[var(--deck-text-mid)] whitespace-nowrap">
                    {formatDateTime(entry.playedAt, dateFormat)}
                  </td>
                  <td className="px-4 py-2.5 text-[var(--deck-text-hi)]">{entry.screen.name}</td>
                  <td className="px-4 py-2.5 text-[var(--deck-text-hi)]">{entry.asset?.name ?? '—'}</td>
                  <td className="px-4 py-2.5 text-[var(--deck-text-mid)]">{t('durationSec', { seconds: Math.round(entry.durationMs / 1000) })}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--deck-glass-border-soft)]">
            <span className="text-xs text-[var(--deck-text-low)]">{t('pageInfo', { page, total: totalPages })}</span>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-[var(--deck-text-mid)] border border-[var(--deck-glass-border)] rounded-lg hover:bg-[var(--deck-glass-fill-strong)] disabled:opacity-40">
                <ChevronLeft className="w-3.5 h-3.5" /> {t('prev')}
              </button>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-[var(--deck-text-mid)] border border-[var(--deck-glass-border)] rounded-lg hover:bg-[var(--deck-glass-fill-strong)] disabled:opacity-40">
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
          <label htmlFor="signal-reports-field-4" className="text-xs text-[var(--deck-text-mid)] mb-1 block">{t('screen')}</label>
          <select id="signal-reports-field-4" value={screenId} onChange={e => setScreenId(e.target.value)}
            className="border border-[var(--deck-glass-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--deck-accent)]">
            <option value="ALL">{t('allScreens')}</option>
            {screens.filter(s => s.streamingType === 'WAYFINDING').map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="signal-reports-field-5" className="text-xs text-[var(--deck-text-mid)] mb-1 block">{t('fromDate')}</label>
          <input id="signal-reports-field-5" type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
            className="border border-[var(--deck-glass-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--deck-accent)]" />
        </div>
        <div>
          <label htmlFor="signal-reports-field-6" className="text-xs text-[var(--deck-text-mid)] mb-1 block">{t('untilDate')}</label>
          <input id="signal-reports-field-6" type="date" value={untilDate} onChange={e => setUntilDate(e.target.value)}
            className="border border-[var(--deck-glass-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--deck-accent)]" />
        </div>
        <span className="text-xs text-[var(--deck-text-low)] pb-2">{t('sessionCount', { count: sessionCount })}</span>
        <button onClick={exportCsv} disabled={events.length === 0}
          className="ms-auto flex items-center gap-2 bg-[var(--deck-accent)] text-white px-4 py-2 rounded-lg text-sm font-medium  disabled:opacity-50">
          <Download className="w-4 h-4" /> {t('exportCsv')}
        </button>
      </div>

      {isLoading && <p className="text-sm text-[var(--deck-text-low)]">{t('kioskLoading')}</p>}

      {!isLoading && truncated && (
        <div className="mb-4 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-lg px-3 py-2">
          {t('truncatedWarning', { shown: events.length, total: data?.total ?? 0 })}
        </div>
      )}

      {!isLoading && events.length === 0 && (
        <div className="text-center py-16 text-[var(--deck-text-low)]">
          <Users2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{t('kioskEmpty')}</p>
        </div>
      )}

      {!isLoading && events.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="glass-panel rounded-2xl p-4">
            <p className="text-xs font-medium text-[var(--deck-text-mid)] mb-3">{t('topSearches')}</p>
            {topSearches.length === 0 ? (
              <p className="text-xs text-[var(--deck-text-low)]">{t('noSearches')}</p>
            ) : (
              <div className="space-y-2">
                {topSearches.map(([query, count]) => (
                  <div key={query} className="flex items-center gap-2 text-xs">
                    <span className="w-28 truncate text-[var(--deck-text-mid)] shrink-0">{query}</span>
                    <div className="flex-1 bg-[var(--deck-glass-fill-strong)] rounded h-3 overflow-hidden">
                      <div className="h-full bg-[var(--deck-accent)]" style={{ width: `${(count / maxSearch) * 100}%` }} />
                    </div>
                    <span className="w-8 text-end text-[var(--deck-text-low)] shrink-0">{count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="glass-panel rounded-2xl p-4">
            <p className="text-xs font-medium text-[var(--deck-text-mid)] mb-3">{t('topDestinations')}</p>
            {topDestinations.length === 0 ? (
              <p className="text-xs text-[var(--deck-text-low)]">{t('noDestinations')}</p>
            ) : (
              <div className="space-y-2">
                {topDestinations.map(([name, count]) => (
                  <div key={name} className="flex items-center gap-2 text-xs">
                    <span className="w-28 truncate text-[var(--deck-text-mid)] shrink-0">{name}</span>
                    <div className="flex-1 bg-[var(--deck-glass-fill-strong)] rounded h-3 overflow-hidden">
                      <div className="h-full bg-emerald-500 dark:bg-emerald-600" style={{ width: `${(count / maxDestination) * 100}%` }} />
                    </div>
                    <span className="w-8 text-end text-[var(--deck-text-low)] shrink-0">{count}</span>
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
    <div className="signal-page signal-workspace-page signal-reports-page space-y-6">
      <div className="signal-page-heading">
        <h1 className="text-2xl font-bold text-[var(--deck-text-hi)]">{t('title')}</h1>
        <p className="text-sm text-[var(--deck-text-mid)] mt-1">{t('subtitle')}</p>
      </div>

      {hasKiosks && (
        <div className="flex gap-1 mb-6 border-b border-[var(--deck-glass-border)]">
          <button
            onClick={() => setTab('proofOfPlay')}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === 'proofOfPlay'
                ? 'border-[var(--deck-accent)] text-[var(--deck-accent)]'
                : 'border-transparent text-[var(--deck-text-mid)] hover:text-[var(--deck-text-hi)]'
            }`}
          >
            {t('tabProofOfPlay')}
          </button>
          <button
            onClick={() => setTab('kiosk')}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === 'kiosk'
                ? 'border-[var(--deck-accent)] text-[var(--deck-accent)]'
                : 'border-transparent text-[var(--deck-text-mid)] hover:text-[var(--deck-text-hi)]'
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
