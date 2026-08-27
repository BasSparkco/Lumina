'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { History, ChevronLeft, ChevronRight, Users, List, Monitor, ImageIcon, LayoutTemplate, Palette, CalendarClock, FolderKanban, Building2, PenTool } from 'lucide-react';
import { auditLogApi, AUDIT_ACTION_STYLES, type AuditResourceType, type AuditLogEntry } from '@/lib/auditLog';
import { usePermissions } from '@/hooks/usePermissions';
import { useRouteGuard } from '@/hooks/useRouteGuard';
import { useDateFormat, formatDateTime } from '@/hooks/useDateFormat';
import { PreviewFeatureNotice } from '@/components/PreviewFeatureNotice';

const RESOURCE_TYPES: AuditResourceType[] = ['MEMBER', 'PLAYLIST', 'SCREEN', 'ASSET', 'LAYOUT', 'THEME', 'SCHEDULE', 'GROUP', 'BUILDING', 'DESIGN'];

const RESOURCE_ICONS: Record<AuditResourceType, typeof Users> = {
  MEMBER: Users,
  PLAYLIST: List,
  SCREEN: Monitor,
  ASSET: ImageIcon,
  LAYOUT: LayoutTemplate,
  THEME: Palette,
  SCHEDULE: CalendarClock,
  GROUP: FolderKanban,
  BUILDING: Building2,
  DESIGN: PenTool,
};

const PAGE_SIZE = 10;

export default function AuditLogPage() {
  const { canViewAuditLog } = usePermissions();
  const canRender = useRouteGuard(canViewAuditLog);
  const t = useTranslations('auditLog');
  const tc = useTranslations('common');
  const { format: dateFormat } = useDateFormat();

  const [resourceType, setResourceType] = useState<AuditResourceType | 'ALL'>('ALL');
  const [fromDate, setFromDate] = useState('');
  const [untilDate, setUntilDate] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [page, setPage] = useState(1);

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['auditLog'], queryFn: auditLogApi.list, enabled: canRender,
  });

  if (!canRender) return null;

  const filtered = entries.filter((e: AuditLogEntry) => {
    if (resourceType !== 'ALL' && e.resourceType !== resourceType) return false;
    const day = e.timestamp.substring(0, 10);
    if (fromDate && day < fromDate) return false;
    if (untilDate && day > untilDate) return false;
    if (userSearch) {
      const q = userSearch.toLowerCase();
      if (!e.userName.toLowerCase().includes(q) && !e.userEmail.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function detailText(entry: AuditLogEntry): string {
    if (!entry.detail) return '—';
    if (entry.action === 'INVITE') return t('detailInvitedAs', { role: tc(`roles.${entry.detail}`) });
    if (entry.action === 'ROLE_CHANGE') return t('detailChangedToRole', { role: tc(`roles.${entry.detail}`) });
    return entry.detail;
  }

  // CREATE/UPDATE/DELETE can happen to any resource type, so the bare action label alone is
  // ambiguous — fold the resource type into it ("Created Playlist"). Every other action here
  // only ever applies to one resource type already (INVITE/ROLE_CHANGE/REMOVE → member,
  // SUBMIT/APPROVE/REJECT → playlist), so the plain label reads fine on its own.
  function actionText(entry: AuditLogEntry): string {
    const resource = t(`resourceTypes.${entry.resourceType}`);
    if (entry.action === 'CREATE') return t('createdResource', { resource });
    if (entry.action === 'UPDATE') return t('updatedResource', { resource });
    if (entry.action === 'DELETE') return t('deletedResource', { resource });
    return t(`actions.${entry.action}`);
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('title')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('subtitle')}</p>
      </div>

      <PreviewFeatureNotice />

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">{t('resourceType')}</label>
          <select value={resourceType} onChange={e => { setResourceType(e.target.value as AuditResourceType | 'ALL'); setPage(1); }}
            className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option value="ALL">{t('allResources')}</option>
            {RESOURCE_TYPES.map(rt => <option key={rt} value={rt}>{t(`resourceTypes.${rt}`)}</option>)}
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
        <div className="flex-1 min-w-[180px]">
          <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">{t('user')}</label>
          <input value={userSearch} onChange={e => { setUserSearch(e.target.value); setPage(1); }}
            placeholder={t('searchUser')}
            className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
      </div>

      {isLoading && <p className="text-sm text-gray-400">{t('loading')}</p>}

      {!isLoading && filtered.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <History className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{t('empty')}</p>
        </div>
      )}

      {!isLoading && filtered.length > 0 && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-800 text-start text-xs text-gray-400 dark:text-gray-500">
                <th className="text-start font-medium px-4 py-2.5">{t('time')}</th>
                <th className="text-start font-medium px-4 py-2.5">{t('user')}</th>
                <th className="text-start font-medium px-4 py-2.5">{t('action')}</th>
                <th className="text-start font-medium px-4 py-2.5">{t('resource')}</th>
                <th className="text-start font-medium px-4 py-2.5">{t('detail')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
              {pageItems.map(entry => {
                const Icon = RESOURCE_ICONS[entry.resourceType];
                return (
                  <tr key={entry.id}>
                    <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {formatDateTime(entry.timestamp, dateFormat)}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="text-gray-900 dark:text-gray-100">{entry.userName}</div>
                      <div className="text-xs text-gray-400 dark:text-gray-500">{entry.userEmail}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${AUDIT_ACTION_STYLES[entry.action]}`}>
                        {actionText(entry)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5 text-gray-700 dark:text-gray-300">
                        <Icon className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 shrink-0" />
                        <span className="truncate">{entry.resourceName || t(`resourceTypes.${entry.resourceType}`)}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400 max-w-xs truncate">{detailText(entry)}</td>
                  </tr>
                );
              })}
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
