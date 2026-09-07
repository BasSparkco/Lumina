'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { History, ChevronLeft, ChevronRight } from 'lucide-react';
import { auditLogApi, type AuditLogParams } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { useRouteGuard } from '@/hooks/useRouteGuard';
import { useDateFormat, formatDateTime } from '@/hooks/useDateFormat';

const PAGE_SIZE = 25;

// P8 (docs/tenant_isolation_and_platform_admin_plan.md) — this used to read a curated,
// per-browser localStorage mock (lib/auditLog.ts), invisible to every other teammate and blind
// to any change made outside this dashboard. It now reads the real, server-side, org-scoped
// AuditLog table that apps/api's AuditInterceptor has already been writing to on every mutating
// request, from every client, all along — nothing was ever swapped in to read it until now.
// `resourceType`/`action` come straight from the request path/method (see AuditInterceptor),
// not a curated enum, so they're shown as-is rather than mapped through a translated label —
// same convention the Super Admin's platform audit log already uses for its own `action` column.
export default function AuditLogPage() {
  const { canViewAuditLog } = usePermissions();
  const canRender = useRouteGuard(canViewAuditLog);
  const t = useTranslations('auditLog');
  const { format: dateFormat } = useDateFormat();

  const [resourceType, setResourceType] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [untilDate, setUntilDate] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [page, setPage] = useState(1);

  const params: AuditLogParams = {
    resourceType: resourceType.trim() || undefined,
    from: fromDate || undefined,
    to: untilDate || undefined,
    userSearch: userSearch.trim() || undefined,
    page,
    pageSize: PAGE_SIZE,
  };

  const { data, isLoading } = useQuery({
    queryKey: ['auditLog', params],
    queryFn: () => auditLogApi.list(params),
    enabled: canRender,
    placeholderData: (prev) => prev,
  });
  const entries = data?.items ?? [];
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

  function resetPage<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setPage(1);
    };
  }

  if (!canRender) return null;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--deck-text-hi)]">{t('title')}</h1>
        <p className="text-sm text-[var(--deck-text-mid)] mt-1">{t('subtitle')}</p>
      </div>

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label className="text-xs text-[var(--deck-text-mid)] mb-1 block">{t('resourceType')}</label>
          <input
            value={resourceType}
            onChange={(e) => resetPage(setResourceType)(e.target.value)}
            placeholder={t('resourceTypePlaceholder')}
            className="border border-[var(--deck-glass-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--deck-accent)]"
          />
        </div>
        <div>
          <label className="text-xs text-[var(--deck-text-mid)] mb-1 block">{t('fromDate')}</label>
          <input type="date" value={fromDate} onChange={e => resetPage(setFromDate)(e.target.value)}
            className="border border-[var(--deck-glass-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--deck-accent)]" />
        </div>
        <div>
          <label className="text-xs text-[var(--deck-text-mid)] mb-1 block">{t('untilDate')}</label>
          <input type="date" value={untilDate} onChange={e => resetPage(setUntilDate)(e.target.value)}
            className="border border-[var(--deck-glass-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--deck-accent)]" />
        </div>
        <div className="flex-1 min-w-[180px]">
          <label className="text-xs text-[var(--deck-text-mid)] mb-1 block">{t('user')}</label>
          <input value={userSearch} onChange={e => resetPage(setUserSearch)(e.target.value)}
            placeholder={t('searchUser')}
            className="w-full border border-[var(--deck-glass-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--deck-accent)]" />
        </div>
      </div>

      {isLoading && !data && <p className="text-sm text-[var(--deck-text-low)]">{t('loading')}</p>}

      {!isLoading && entries.length === 0 && (
        <div className="text-center py-16 text-[var(--deck-text-low)]">
          <History className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{t('empty')}</p>
        </div>
      )}

      {entries.length > 0 && (
        <div className="glass-panel rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--deck-glass-border-soft)] text-start text-xs text-[var(--deck-text-low)]">
                  <th className="text-start font-medium px-4 py-2.5">{t('time')}</th>
                  <th className="text-start font-medium px-4 py-2.5">{t('user')}</th>
                  <th className="text-start font-medium px-4 py-2.5">{t('action')}</th>
                  <th className="text-start font-medium px-4 py-2.5">{t('resource')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--deck-glass-border-soft)]">
                {entries.map(entry => (
                  <tr key={entry.id}>
                    <td className="px-4 py-2.5 text-[var(--deck-text-mid)] whitespace-nowrap">
                      {formatDateTime(entry.createdAt, dateFormat)}
                    </td>
                    <td className="px-4 py-2.5">
                      {entry.user ? (
                        <>
                          <div className="text-[var(--deck-text-hi)]">{entry.user.name}</div>
                          <div className="text-xs text-[var(--deck-text-low)]">{entry.user.email}</div>
                        </>
                      ) : (
                        <span className="text-[var(--deck-text-low)]">{t('deletedUser')}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-[var(--deck-text-hi)]">{entry.action}</td>
                    <td className="px-4 py-2.5 text-[var(--deck-text-mid)]">
                      <span className="rounded-full bg-[var(--deck-glass-fill-strong)] px-2 py-0.5 text-[11px] font-medium text-[var(--deck-text-mid)]">
                        {entry.resourceType}
                      </span>
                      {entry.resourceId && <span className="ms-1.5 font-mono text-xs">{entry.resourceId}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

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
