'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Monitor, ImageIcon, List, LogOut, Tv, LayoutTemplate, PenTool, Layers, CalendarClock, PowerCircle, Users, History, BarChart3, CreditCard, Settings, PanelLeftClose, PanelLeftOpen, LayoutDashboard, Menu, X, MapPin, ChevronDown } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { EditorDirtyProvider, useEditorDirty } from '@/context/EditorDirtyContext';
import { usePermissions } from '@/hooks/usePermissions';
import { useSidebarCollapsed } from '@/hooks/useSidebarCollapsed';
import { playlistsApi } from '@/lib/api';
import { approvalsApi } from '@/lib/mocks/approvals';

type Permissions = ReturnType<typeof usePermissions>;
type NavItem = { href: string; key: string; icon: typeof Monitor; visible?: (p: Permissions) => boolean; children?: NavItem[] };
type NavSection = { titleKey: string; items: NavItem[] };

const navSections: NavSection[] = [
  { titleKey: 'overview', items: [
    { href: '/dashboard', key: 'dashboard', icon: LayoutDashboard },
  ] },
  { titleKey: 'content', items: [
    { href: '/assets', key: 'assets', icon: ImageIcon },
    { href: '/playlists', key: 'playlists', icon: List },
    { href: '/screens', key: 'screens', icon: Monitor },
    { href: '/designer', key: 'designer', icon: LayoutTemplate, children: [
      { href: '/designer2', key: 'designer2', icon: PenTool },
    ] },
    { href: '/templates', key: 'templates', icon: Layers },
  ] },
  { titleKey: 'operations', items: [
    { href: '/wayfinding', key: 'wayfinding', icon: MapPin },
    { href: '/schedules', key: 'schedules', icon: CalendarClock },
    { href: '/power-schedule', key: 'powerSchedule', icon: PowerCircle },
  ] },
  { titleKey: 'management', items: [
    { href: '/members', key: 'members', icon: Users, visible: p => p.canManageMembers },
    // Temporarily hidden for the testing phase — restore `visible: p => p.canManageBilling` to bring it back.
    { href: '/billing', key: 'billing', icon: CreditCard, visible: () => false },
    { href: '/audit-log', key: 'auditLog', icon: History, visible: p => p.canViewAuditLog },
    { href: '/reports', key: 'reports', icon: BarChart3 },
  ] },
  { titleKey: 'settings', items: [
    { href: '/settings', key: 'settings', icon: Settings },
  ] },
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
  const [toggledSubmenus, setToggledSubmenus] = useState<Record<string, boolean>>({});
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

  // Close the mobile drawer whenever the route changes so picking a page doesn't leave it open,
  // and auto-collapse the sidebar on entering the canvas-heavy Designer so it has more room.
  // Adjusting state during render (rather than in an effect) avoids an extra post-navigation
  // render pass. Collapsing only fires on the transition into /designer, not on every render
  // while there, so it doesn't fight a user who manually re-expands mid-session. If it was open
  // when they entered, restoreOnExitRef remembers to reopen it on the way out; a manual toggle
  // while inside the Designer cancels that so leaving doesn't override the user's own choice.
  const restoreOnExitRef = useRef(false);
  const [prevPath, setPrevPath] = useState(path);
  if (path !== prevPath) {
    const wasInDesigner = prevPath.includes('/designer');
    const isInDesigner = path.includes('/designer');
    setPrevPath(path);
    setMobileOpen(false);
    if (isInDesigner && !wasInDesigner) {
      restoreOnExitRef.current = !collapsed;
      if (!collapsed) setCollapsed(true);
    } else if (wasInDesigner && !isInDesigner) {
      if (restoreOnExitRef.current) setCollapsed(false);
      restoreOnExitRef.current = false;
    }
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
          <button onClick={() => { restoreOnExitRef.current = false; setCollapsed(!collapsed); }} title={collapsed ? t('expandSidebar') : t('collapseSidebar')}
            className="ms-auto hidden md:block text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 shrink-0">
            {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
          <button onClick={() => setMobileOpen(false)} title={t('closeMenu')}
            className="ms-auto md:hidden text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
        <nav className="flex-1 py-2 px-2 space-y-1 overflow-y-auto">
          {navSections.map((section, sectionIndex) => {
            const items = section.items.filter(item => !item.visible || item.visible(perms));
            if (items.length === 0) return null;
            return (
              <div key={section.titleKey}>
                {effectiveCollapsed ? (
                  sectionIndex > 0 && <div className="mx-3 my-2 border-t border-gray-100 dark:border-gray-800" />
                ) : (
                  <div className={`px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-600 ${sectionIndex > 0 ? 'pt-4' : 'pt-1'}`}>
                    {t(`sections.${section.titleKey}`)}
                  </div>
                )}
                <div className="space-y-1">
                  {items.map(item => {
                    const { href, key, icon: Icon, children } = item;
                    const label = t(key);
                    const badgeCount = key === 'playlists' ? pendingApprovalsCount : 0;
                    const target = `/${locale}${href}`;
                    const active = path.includes(href);
                    const childActive = !!children?.some(c => path.includes(c.href));
                    const submenuOpen = toggledSubmenus[key] ?? childActive;

                    const handleClick = (e: React.MouseEvent) => {
                      // Leave modified clicks (new tab/window, middle-click) to the browser's default
                      // handling — only plain navigation needs the unsaved-changes guard.
                      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                      e.preventDefault();
                      guardNavigation(t('unsavedChangesConfirm'), () => router.push(target));
                    };

                    return (
                      <div key={href}>
                        <div className={`flex items-center rounded-lg ${
                          active ? 'bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                        }`}>
                          <Link href={target} title={effectiveCollapsed ? label : undefined} onClick={handleClick}
                            className={`flex flex-1 items-center gap-3 px-3 py-2 text-sm font-medium transition-colors min-w-0 ${effectiveCollapsed ? 'justify-center' : ''}`}>
                            <span className="relative shrink-0">
                              <Icon className="w-4 h-4" />
                              {effectiveCollapsed && badgeCount > 0 && (
                                <span className="absolute -top-1 -end-1 w-2 h-2 rounded-full bg-red-500" />
                              )}
                            </span>
                            {!effectiveCollapsed && <span className="truncate">{label}</span>}
                            {!effectiveCollapsed && badgeCount > 0 && (
                              <span className="ms-auto flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold shrink-0">
                                {badgeCount}
                              </span>
                            )}
                          </Link>
                          {!effectiveCollapsed && children && children.length > 0 && (
                            <button type="button" title={submenuOpen ? t('collapseSubmenu') : t('expandSubmenu')}
                              onClick={() => setToggledSubmenus(prev => ({ ...prev, [key]: !submenuOpen }))}
                              className="pe-3 ps-1 py-2 shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                              <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${submenuOpen ? 'rotate-180' : ''}`} />
                            </button>
                          )}
                        </div>
                        {!effectiveCollapsed && children && children.length > 0 && (
                          <div className={`grid transition-[grid-template-rows] duration-200 ease-in-out ${submenuOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                            <div className="overflow-hidden">
                              <div className="ps-6 mt-1 space-y-1">
                                {children.map(child => {
                                  const childTarget = `/${locale}${child.href}`;
                                  const isChildActive = path.includes(child.href);
                                  const ChildIcon = child.icon;
                                  return (
                                    <Link key={child.href} href={childTarget}
                                      onClick={e => {
                                        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                                        e.preventDefault();
                                        guardNavigation(t('unsavedChangesConfirm'), () => router.push(childTarget));
                                      }}
                                      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                                        isChildActive ? 'bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                                      }`}>
                                      <ChildIcon className="w-3.5 h-3.5 shrink-0" />
                                      <span className="truncate">{t(child.key)}</span>
                                    </Link>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
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
