'use client';
import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Monitor, ImageIcon, List, LogOut, Tv, LayoutTemplate, Palette, CalendarClock, Users, History, BarChart3, CreditCard, Settings, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import { useSidebarCollapsed } from '@/hooks/useSidebarCollapsed';
import { playlistsApi } from '@/lib/api';
import { approvalsApi } from '@/lib/mocks/approvals';

type Permissions = ReturnType<typeof usePermissions>;

const nav: { href: string; key: string; icon: typeof Monitor; visible?: (p: Permissions) => boolean }[] = [
  { href: '/screens', key: 'screens', icon: Monitor },
  { href: '/assets', key: 'assets', icon: ImageIcon },
  { href: '/playlists', key: 'playlists', icon: List },
  { href: '/layouts', key: 'layouts', icon: LayoutTemplate },
  { href: '/themes', key: 'themes', icon: Palette },
  { href: '/schedules', key: 'schedules', icon: CalendarClock },
  { href: '/members', key: 'members', icon: Users, visible: p => p.canManageMembers },
  { href: '/billing', key: 'billing', icon: CreditCard, visible: p => p.canManageBilling },
  { href: '/audit-log', key: 'auditLog', icon: History, visible: p => p.canViewAuditLog },
  { href: '/reports', key: 'reports', icon: BarChart3 },
  { href: '/settings', key: 'settings', icon: Settings },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const perms = usePermissions();
  const { collapsed, setCollapsed } = useSidebarCollapsed();
  const router = useRouter();
  const locale = useLocale();
  const path = usePathname();
  const t = useTranslations('nav');

  // Shares its query keys with the Playlists page's own fetches, so this doesn't add an extra
  // network round-trip when that page is already open. The pending-approvals section now lives
  // on the Playlists page itself; this badge is just a heads-up in the nav.
  const { data: playlists = [] } = useQuery({ queryKey: ['playlists'], queryFn: playlistsApi.list, enabled: perms.canApproveContent });
  const { data: approvals = {} } = useQuery({ queryKey: ['approvals'], queryFn: approvalsApi.listAll, enabled: perms.canApproveContent });
  const pendingApprovalsCount = playlists.filter(pl => approvals[pl.id]?.status === 'PENDING').length;

  useEffect(() => {
    if (!loading && !user) router.replace(`/${locale}/login`);
  }, [user, loading, router, locale]);

  if (loading || !user) return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="text-gray-400 text-sm">{t('loading')}</div>
    </div>
  );

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-950 overflow-hidden">
      {/* Sidebar */}
      <aside className={`${collapsed ? 'w-16' : 'w-56'} bg-white dark:bg-gray-900 border-e border-gray-200 dark:border-gray-800 flex flex-col shrink-0 transition-all`}>
        <div className="flex items-center gap-2 px-5 py-5 border-b border-gray-100 dark:border-gray-800">
          <Tv className="w-5 h-5 text-indigo-600 shrink-0" />
          {!collapsed && <span className="font-semibold text-gray-900 dark:text-gray-100 text-sm truncate">Lumina</span>}
          <button onClick={() => setCollapsed(!collapsed)} title={collapsed ? t('expandSidebar') : t('collapseSidebar')}
            className="ms-auto text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 shrink-0">
            {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
        </div>
        <nav className="flex-1 py-4 px-2 space-y-1">
          {nav.filter(item => !item.visible || item.visible(perms)).map(({ href, key, icon: Icon }) => {
            const active = path.includes(href);
            const label = t(key);
            const badgeCount = key === 'playlists' ? pendingApprovalsCount : 0;
            return (
              <Link key={href} href={`/${locale}${href}`} title={collapsed ? label : undefined}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${collapsed ? 'justify-center' : ''} ${
                  active ? 'bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}>
                <span className="relative shrink-0">
                  <Icon className="w-4 h-4" />
                  {collapsed && badgeCount > 0 && (
                    <span className="absolute -top-1 -end-1 w-2 h-2 rounded-full bg-red-500" />
                  )}
                </span>
                {!collapsed && label}
                {!collapsed && badgeCount > 0 && (
                  <span className="ms-auto flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold">
                    {badgeCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="px-3 py-4 border-t border-gray-100 dark:border-gray-800">
          {!collapsed && <div className="px-3 py-2 text-xs text-gray-400 truncate">{user.email}</div>}
          <button onClick={logout} title={collapsed ? t('signOut') : undefined}
            className={`flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-gray-200 transition-colors ${collapsed ? 'justify-center' : ''}`}>
            <LogOut className="w-4 h-4 shrink-0" /> {!collapsed && t('signOut')}
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
