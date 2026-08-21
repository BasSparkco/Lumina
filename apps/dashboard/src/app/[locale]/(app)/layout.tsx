'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Monitor, ImageIcon, List, LogOut, Tv, LayoutTemplate, CalendarClock, PowerCircle, Users, History, BarChart3, CreditCard, Settings, PanelLeftClose, PanelLeftOpen, LayoutDashboard, Menu, X, MapPin } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { EditorDirtyProvider, useEditorDirty } from '@/context/EditorDirtyContext';
import { usePermissions } from '@/hooks/usePermissions';
import { useSidebarCollapsed } from '@/hooks/useSidebarCollapsed';
import { playlistsApi } from '@/lib/api';
import { approvalsApi } from '@/lib/mocks/approvals';

type Permissions = ReturnType<typeof usePermissions>;

const nav: { href: string; key: string; icon: typeof Monitor; visible?: (p: Permissions) => boolean }[] = [
  { href: '/dashboard', key: 'dashboard', icon: LayoutDashboard },
  { href: '/screens', key: 'screens', icon: Monitor },
  { href: '/assets', key: 'assets', icon: ImageIcon },
  { href: '/playlists', key: 'playlists', icon: List },
  { href: '/layouts', key: 'layouts', icon: LayoutTemplate },
  { href: '/wayfinding', key: 'wayfinding', icon: MapPin },
  { href: '/schedules', key: 'schedules', icon: CalendarClock },
  { href: '/power-schedule', key: 'powerSchedule', icon: PowerCircle },
  { href: '/members', key: 'members', icon: Users, visible: p => p.canManageMembers },
  { href: '/billing', key: 'billing', icon: CreditCard, visible: p => p.canManageBilling },
  { href: '/audit-log', key: 'auditLog', icon: History, visible: p => p.canViewAuditLog },
  { href: '/reports', key: 'reports', icon: BarChart3 },
  { href: '/settings', key: 'settings', icon: Settings },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <EditorDirtyProvider>
      <AppShell>{children}</AppShell>
    </EditorDirtyProvider>
  );
}

function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const perms = usePermissions();
  const { collapsed, setCollapsed } = useSidebarCollapsed();
  const [mobileOpen, setMobileOpen] = useState(false);
  const router = useRouter();
  const locale = useLocale();
  const path = usePathname();
  const t = useTranslations('nav');
  const { guardNavigation } = useEditorDirty();

  // The mobile drawer overlay only ever opens on small screens (the hamburger trigger that
  // opens it is `md:hidden`), so overriding the desktop-persisted `collapsed` preference
  // whenever it's open is safe — it just means the drawer always shows full labels instead of
  // inheriting whatever icon-only state was left over from a desktop session.
  const effectiveCollapsed = collapsed && !mobileOpen;

  // Close the mobile drawer whenever the route changes so picking a page doesn't leave it open.
  // Adjusting state during render (rather than in an effect) avoids an extra post-navigation
  // render pass just to dismiss the drawer.
  const [drawerPath, setDrawerPath] = useState(path);
  if (path !== drawerPath) {
    setDrawerPath(path);
    setMobileOpen(false);
  }

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
      {/* Mobile hamburger trigger — hidden once the drawer is open, since the drawer's own
          close button takes over at that point. */}
      {!mobileOpen && (
        <button onClick={() => setMobileOpen(true)} title={t('openMenu')}
          className="fixed top-4 end-4 z-20 md:hidden inline-flex items-center justify-center w-10 h-10 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300 shadow-sm">
          <Menu className="w-5 h-5" />
        </button>
      )}

      {/* Mobile backdrop */}
      {mobileOpen && (
        <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`fixed inset-y-0 start-0 z-40 transition-all duration-200 ease-in-out ${
        mobileOpen ? 'translate-x-0' : '-translate-x-full rtl:translate-x-full'
      } md:static md:translate-x-0 md:rtl:translate-x-0 ${effectiveCollapsed ? 'w-16' : 'w-56'} bg-white dark:bg-gray-900 border-e border-gray-200 dark:border-gray-800 flex flex-col shrink-0`}>
        <div className="flex items-center gap-2 px-5 py-5 border-b border-gray-100 dark:border-gray-800">
          <Tv className="w-5 h-5 text-indigo-600 shrink-0" />
          {!effectiveCollapsed && <span className="font-semibold text-gray-900 dark:text-gray-100 text-sm truncate">Lumina</span>}
          <button onClick={() => setCollapsed(!collapsed)} title={collapsed ? t('expandSidebar') : t('collapseSidebar')}
            className="ms-auto hidden md:block text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 shrink-0">
            {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
          <button onClick={() => setMobileOpen(false)} title={t('closeMenu')}
            className="ms-auto md:hidden text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
        <nav className="flex-1 py-4 px-2 space-y-1">
          {nav.filter(item => !item.visible || item.visible(perms)).map(({ href, key, icon: Icon }) => {
            const active = path.includes(href);
            const label = t(key);
            const badgeCount = key === 'playlists' ? pendingApprovalsCount : 0;
            const target = `/${locale}${href}`;
            return (
              <Link key={href} href={target} title={effectiveCollapsed ? label : undefined}
                onClick={e => {
                  // Leave modified clicks (new tab/window, middle-click) to the browser's default
                  // handling — only plain navigation needs the unsaved-changes guard.
                  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                  e.preventDefault();
                  guardNavigation(t('unsavedChangesConfirm'), () => router.push(target));
                }}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${effectiveCollapsed ? 'justify-center' : ''} ${
                  active ? 'bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}>
                <span className="relative shrink-0">
                  <Icon className="w-4 h-4" />
                  {effectiveCollapsed && badgeCount > 0 && (
                    <span className="absolute -top-1 -end-1 w-2 h-2 rounded-full bg-red-500" />
                  )}
                </span>
                {!effectiveCollapsed && label}
                {!effectiveCollapsed && badgeCount > 0 && (
                  <span className="ms-auto flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold">
                    {badgeCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="px-3 py-4 border-t border-gray-100 dark:border-gray-800">
          {!effectiveCollapsed && <div className="px-3 py-2 text-xs text-gray-400 truncate">{user.email}</div>}
          <button onClick={() => guardNavigation(t('unsavedChangesConfirm'), logout)} title={effectiveCollapsed ? t('signOut') : undefined}
            className={`flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-gray-200 transition-colors ${effectiveCollapsed ? 'justify-center' : ''}`}>
            <LogOut className="w-4 h-4 shrink-0" /> {!effectiveCollapsed && t('signOut')}
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
