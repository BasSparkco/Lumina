'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import {
  Building2,
  ChevronRight,
  Languages,
  LogOut,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  Sun,
  X,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { AppSidebarProvider } from '@/context/AppSidebarContext';
import { useEditorDirty } from '@/context/EditorDirtyContext';
import { useTheme } from '@/context/ThemeContext';
import { usePermissions } from '@/hooks/usePermissions';
import { useSidebarCollapsed } from '@/hooks/useSidebarCollapsed';
import { useCapabilities } from '@/hooks/useCapabilities';
import { playlistsApi } from '@/lib/api';
import {
  getActiveNavigation,
  getAppPath,
  getVisibleNavigation,
} from '@/lib/appNavigation';

export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading, logout } = useAuth();
  const permissions = usePermissions();
  const { hasModule, isLoading: capabilitiesLoading } = useCapabilities();
  const { collapsed, setCollapsed } = useSidebarCollapsed();
  const { theme, toggleTheme } = useTheme();
  const { guardNavigation } = useEditorDirty();
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale();
  const t = useTranslations('nav');
  const ts = useTranslations('shell');
  const [mobileOpen, setMobileOpen] = useState(false);
  const sidebar = useRef<HTMLElement>(null);
  const main = useRef<HTMLDivElement>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const appPath = getAppPath(pathname, locale);
  const isDesigner2 = appPath === '/designer2';
  const isLegacyDesigner = appPath === '/designer';
  // Editors keep their own full-height toolbars and deck palette in this rollout.
  const isEditor = isDesigner2 || isLegacyDesigner;
  const effectiveCollapsed = collapsed && !mobileOpen;
  const active = getActiveNavigation(pathname, locale);
  const sections = getVisibleNavigation(
    permissions,
    hasModule,
    capabilitiesLoading,
  );
  const isPlatform = appPath.startsWith('/admin/');

  const [restoreOnExit, setRestoreOnExit] = useState(false);
  const [previousPath, setPreviousPath] = useState(pathname);
  if (pathname !== previousPath) {
    const wasDesigner = getAppPath(previousPath, locale) === '/designer';
    setPreviousPath(pathname);
    setMobileOpen(false);
    if (isLegacyDesigner && !wasDesigner) {
      setRestoreOnExit(!collapsed);
      if (!collapsed) setCollapsed(true);
    } else if (wasDesigner && !isLegacyDesigner) {
      if (restoreOnExit) setCollapsed(false);
      setRestoreOnExit(false);
    }
  }

  const { data: playlists = [] } = useQuery({
    queryKey: ['playlists'],
    queryFn: playlistsApi.list,
    enabled: !!user && permissions.canApproveContent,
  });
  const pendingCount = playlists.filter(
    (playlist) => playlist.approvalStatus === 'PENDING',
  ).length;

  useEffect(() => {
    if (!loading && !user) router.replace(`/${locale}/login`);
  }, [user, loading, router, locale]);

  // Match the CSS breakpoint. Closed drawers must not leave offscreen links in the
  // keyboard order. Inert is synchronized before restoring focus on drawer close.
  useEffect(() => {
    const element = sidebar.current;
    if (!element) return;
    const media = window.matchMedia('(min-width: 768px)');
    const sync = () => {
      element.inert = !mobileOpen && (isDesigner2 || !media.matches);
    };
    sync();
    const onResize = () => {
      sync();
      if (media.matches && !isDesigner2) setMobileOpen(false);
    };
    media.addEventListener('change', onResize);
    return () => media.removeEventListener('change', onResize);
  }, [mobileOpen, isDesigner2, loading, user]);

  useEffect(() => {
    if (!mobileOpen || !sidebar.current) return;
    const element = sidebar.current;
    const previous = document.activeElement as HTMLElement | null;
    const content = main.current;
    const trigger = menuTrigger.current;
    if (content) content.inert = true;
    const focusable = () =>
      Array.from(
        element.querySelectorAll<HTMLElement>('a[href],button:not(:disabled)'),
      ).filter((item) => item.getClientRects().length > 0);
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMobileOpen(false);
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    element.addEventListener('keydown', onKeyDown);
    return () => {
      element.removeEventListener('keydown', onKeyDown);
      if (content) content.inert = false;
      if (previous?.isConnected) previous.focus();
      else trigger?.focus();
    };
  }, [mobileOpen]);

  const switchLocale = () => {
    const next = locale === 'ar' ? 'en' : 'ar';
    guardNavigation(t('unsavedChangesConfirm'), () => {
      // Preserve template/design ids, current filters and anchors when switching languages.
      router.push(
        `/${next}${appPath}${window.location.search}${window.location.hash}`,
      );
    });
  };

  if (loading || !user)
    return (
      <div className="signal-shell signal-loading" role="status">
        {t('loading')}
      </div>
    );

  const role = ts(`roles.${user.role}`);
  const name = user.name || user.email;

  return (
    <div
      className={`signal-shell ${isDesigner2 ? 'signal-editor-shell' : ''}`}
      dir={locale === 'ar' ? 'rtl' : 'ltr'}
    >
      <a className="signal-skip" href="#app-content">
        {ts('skipToContent')}
      </a>
      {mobileOpen && (
        <div
          className="signal-backdrop"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside
        ref={sidebar}
        id="app-navigation"
        aria-label={ts('navigation')}
        className={`signal-sidebar ${mobileOpen ? 'is-open' : ''} ${effectiveCollapsed ? 'is-collapsed' : ''}`}
      >
        <div className="signal-brand-row">
          <span className="signal-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          {!effectiveCollapsed && (
            <span className="signal-wordmark" dir="ltr">
              lumina<span>.</span>
            </span>
          )}
          {!isDesigner2 && (
            <button
              type="button"
              className="signal-icon-button signal-collapse"
              title={collapsed ? t('expandSidebar') : t('collapseSidebar')}
              aria-label={collapsed ? t('expandSidebar') : t('collapseSidebar')}
              onClick={() => {
                setRestoreOnExit(false);
                setCollapsed(!collapsed);
              }}
            >
              {collapsed ? (
                <PanelLeftOpen size={18} />
              ) : (
                <PanelLeftClose size={18} />
              )}
            </button>
          )}
          <button
            type="button"
            className="signal-icon-button signal-close"
            aria-label={t('closeMenu')}
            onClick={() => setMobileOpen(false)}
          >
            <X size={20} />
          </button>
        </div>
        {!effectiveCollapsed && (
          <div className="signal-workspace">
            <span className="signal-workspace-icon">
              {isPlatform ? <ShieldCheck size={19} /> : <Building2 size={19} />}
            </span>
            <div>
              <strong>{isPlatform ? ts('platform') : ts('workspace')}</strong>
              <small>{isPlatform ? ts('platformScope') : role}</small>
            </div>
          </div>
        )}
        <nav className="signal-nav" aria-label={ts('navigation')}>
          {sections.map((section) => (
            <div key={section.key} className="signal-nav-section">
              {!effectiveCollapsed && (
                <div
                  className={`signal-nav-label ${section.key === 'platform' ? 'signal-platform-label' : ''}`}
                >
                  {t(`sections.${section.key}`)}
                </div>
              )}
              {section.items.map((item) => {
                const Icon = item.icon;
                const label = t(item.key);
                const count = item.key === 'playlists' ? pendingCount : 0;
                return (
                  <Link
                    key={item.href}
                    href={`/${locale}${item.href}`}
                    aria-label={label}
                    title={effectiveCollapsed ? label : undefined}
                    aria-current={
                      active?.href === item.href ? 'page' : undefined
                    }
                    className="signal-nav-link"
                    onClick={(event) => {
                      if (
                        event.button !== 0 ||
                        event.metaKey ||
                        event.ctrlKey ||
                        event.shiftKey ||
                        event.altKey
                      )
                        return;
                      event.preventDefault();
                      guardNavigation(t('unsavedChangesConfirm'), () => {
                        setMobileOpen(false);
                        router.push(`/${locale}${item.href}`);
                      });
                    }}
                  >
                    <Icon size={18} aria-hidden="true" />
                    {!effectiveCollapsed && (
                      <span className="signal-nav-text">{label}</span>
                    )}
                    {count > 0 && (
                      <span
                        className={
                          effectiveCollapsed
                            ? 'signal-count-dot'
                            : 'signal-nav-count'
                        }
                        aria-label={ts('pendingApprovals', { count })}
                      >
                        {!effectiveCollapsed &&
                          new Intl.NumberFormat(locale).format(count)}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="signal-account">
          {!effectiveCollapsed && (
            <div className="signal-account-info">
              <span className="signal-avatar" aria-hidden="true">
                {Array.from(name)[0]?.toLocaleUpperCase(locale)}
              </span>
              <div>
                <strong title={name}>{name}</strong>
                <small title={user.email} dir="ltr">
                  {user.email}
                </small>
              </div>
            </div>
          )}
          <button
            type="button"
            className="signal-nav-link"
            aria-label={t('signOut')}
            title={effectiveCollapsed ? t('signOut') : undefined}
            onClick={() => guardNavigation(t('unsavedChangesConfirm'), logout)}
          >
            <LogOut size={18} />
            {!effectiveCollapsed && <span>{t('signOut')}</span>}
          </button>
        </div>
      </aside>
      <div
        ref={main}
        className={`signal-main ${isEditor ? 'signal-editor-content' : 'signal-management'}`}
      >
        {!isEditor && (
          <header className="signal-header">
            <div className="signal-breadcrumb">
              <button
                ref={menuTrigger}
                type="button"
                className="signal-icon-button signal-menu"
                aria-label={t('openMenu')}
                aria-expanded={mobileOpen}
                aria-controls="app-navigation"
                onClick={() => setMobileOpen(true)}
              >
                <Menu size={21} />
              </button>
              <span className="signal-breadcrumb-root">
                {isPlatform ? ts('platform') : ts('workspace')}
              </span>
              <ChevronRight
                size={14}
                className="signal-chevron signal-breadcrumb-root"
              />
              <span className="signal-page-name">
                {active ? t(active.key) : ts('workspace')}
              </span>
            </div>
            <div className="signal-header-actions">
              <button
                type="button"
                className="signal-icon-button"
                onClick={switchLocale}
                aria-label={
                  locale === 'ar' ? ts('switchToEnglish') : ts('switchToArabic')
                }
                title={
                  locale === 'ar' ? ts('switchToEnglish') : ts('switchToArabic')
                }
              >
                <Languages size={18} />
                <span>{locale === 'ar' ? 'EN' : 'ع'}</span>
              </button>
              <button
                type="button"
                className="signal-icon-button"
                onClick={toggleTheme}
                aria-label={theme === 'dark' ? ts('lightMode') : ts('darkMode')}
                title={theme === 'dark' ? ts('lightMode') : ts('darkMode')}
              >
                {theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
              </button>
            </div>
          </header>
        )}
        {isLegacyDesigner && (
          <button
            ref={menuTrigger}
            type="button"
            className="signal-icon-button signal-menu signal-editor-menu"
            aria-label={t('openMenu')}
            aria-controls="app-navigation"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen(true)}
          >
            <Menu size={20} />
          </button>
        )}
        <main id="app-content" tabIndex={-1} className="signal-content">
          <AppSidebarProvider open={mobileOpen} setOpen={setMobileOpen}>
            {children}
          </AppSidebarProvider>
        </main>
      </div>
    </div>
  );
}
