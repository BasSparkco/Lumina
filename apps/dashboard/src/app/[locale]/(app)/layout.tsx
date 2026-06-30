'use client';
import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useLocale } from 'next-intl';
import { Monitor, ImageIcon, List, LogOut, Tv, LayoutTemplate, CalendarClock } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

const nav = [
  { href: '/screens', label: 'Screens', icon: Monitor },
  { href: '/assets', label: 'Assets', icon: ImageIcon },
  { href: '/playlists', label: 'Playlists', icon: List },
  { href: '/layouts', label: 'Layouts', icon: LayoutTemplate },
  { href: '/schedules', label: 'Schedules', icon: CalendarClock },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const locale = useLocale();
  const path = usePathname();

  useEffect(() => {
    if (!loading && !user) router.replace(`/${locale}/login`);
  }, [user, loading, router, locale]);

  if (loading || !user) return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <div className="text-gray-400 text-sm">Loading…</div>
    </div>
  );

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 bg-white border-e border-gray-200 flex flex-col shrink-0">
        <div className="flex items-center gap-2 px-5 py-5 border-b border-gray-100">
          <Tv className="w-5 h-5 text-indigo-600" />
          <span className="font-semibold text-gray-900 text-sm">Lumina</span>
        </div>
        <nav className="flex-1 py-4 px-2 space-y-1">
          {nav.map(({ href, label, icon: Icon }) => {
            const active = path.includes(href);
            return (
              <a key={href} href={`/${locale}${href}`}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  active ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:bg-gray-100'
                }`}>
                <Icon className="w-4 h-4 shrink-0" />
                {label}
              </a>
            );
          })}
        </nav>
        <div className="px-3 py-4 border-t border-gray-100">
          <div className="px-3 py-2 text-xs text-gray-400 truncate">{user.email}</div>
          <button onClick={logout}
            className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors">
            <LogOut className="w-4 h-4" /> Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
