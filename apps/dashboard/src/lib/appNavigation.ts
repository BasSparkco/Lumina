import {
  Monitor,
  ImageIcon,
  List,
  LayoutTemplate,
  PenTool,
  Layers,
  CalendarClock,
  PowerCircle,
  Users,
  History,
  BarChart3,
  CreditCard,
  Settings,
  LayoutDashboard,
  MapPin,
  Building2,
  Sparkles,
  DoorOpen,
  type LucideIcon,
} from 'lucide-react';
import type { ModuleKey } from '@lumina/types';
import type { usePermissions } from '@/hooks/usePermissions';

type Permissions = ReturnType<typeof usePermissions>;
export interface AppNavItem {
  href: string;
  key: string;
  icon: LucideIcon;
  visible?: (permissions: Permissions) => boolean;
  requiredModule?: ModuleKey;
}
export interface AppNavSection {
  key: string;
  items: AppNavItem[];
}

// Presentation only. The existing route guards and API remain the access boundary.
// Keep module-gated entries flat so every entry goes through the capability filter.
export const appNavigation: AppNavSection[] = [
  {
    key: 'overview',
    items: [{ href: '/dashboard', key: 'dashboard', icon: LayoutDashboard }],
  },
  {
    key: 'workspace',
    items: [
      { href: '/screens', key: 'screens', icon: Monitor },
      { href: '/assets', key: 'assets', icon: ImageIcon },
      { href: '/playlists', key: 'playlists', icon: List },
      { href: '/schedules', key: 'schedules', icon: CalendarClock },
      { href: '/power-schedule', key: 'powerSchedule', icon: PowerCircle },
    ],
  },
  {
    key: 'design',
    items: [
      // Both editors remain reachable throughout the existing replacement trial.
      { href: '/designer', key: 'designer', icon: LayoutTemplate },
      { href: '/designer2', key: 'designer2', icon: PenTool },
      { href: '/templates', key: 'templates', icon: Layers },
    ],
  },
  {
    key: 'operations',
    items: [
      {
        href: '/wayfinding',
        key: 'wayfinding',
        icon: MapPin,
        requiredModule: 'WAYFINDING',
      },
      {
        href: '/wayfinding/ai',
        key: 'wayfindingAi',
        icon: Sparkles,
        requiredModule: 'WAYFINDING_AI',
      },
      {
        href: '/room-booking',
        key: 'roomBooking',
        icon: DoorOpen,
        requiredModule: 'ROOM_BOOKING',
      },
    ],
  },
  {
    key: 'management',
    items: [
      {
        href: '/members',
        key: 'members',
        icon: Users,
        visible: (p) => p.canManageMembers,
      },
      {
        href: '/audit-log',
        key: 'auditLog',
        icon: History,
        visible: (p) => p.canViewAuditLog,
      },
      { href: '/reports', key: 'reports', icon: BarChart3 },
      // Deliberately remains hidden during the existing billing testing phase.
      {
        href: '/billing',
        key: 'billing',
        icon: CreditCard,
        visible: () => false,
      },
      { href: '/settings', key: 'settings', icon: Settings },
    ],
  },
  {
    key: 'platform',
    items: [
      {
        href: '/admin/templates',
        key: 'adminTemplates',
        icon: Layers,
        visible: (p) => p.isSuperAdmin,
      },
      {
        href: '/admin/tenants',
        key: 'adminTenants',
        icon: Building2,
        visible: (p) => p.isSuperAdmin,
      },
    ],
  },
];

export function getVisibleNavigation(
  permissions: Permissions,
  hasModule: (key: ModuleKey) => boolean,
  capabilitiesLoading: boolean,
): AppNavSection[] {
  return appNavigation
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) =>
          (!item.visible || item.visible(permissions)) &&
          (!item.requiredModule ||
            (!capabilitiesLoading && hasModule(item.requiredModule))),
      ),
    }))
    .filter((section) => section.items.length > 0);
}

export function getAppPath(pathname: string, locale: string): string {
  const prefix = `/${locale}`;
  const path =
    pathname === prefix
      ? '/'
      : pathname.startsWith(`${prefix}/`)
        ? pathname.slice(prefix.length)
        : pathname;
  return path.replace(/\/+$/, '') || '/';
}

// Longest segment match: /wayfinding/ai must not also activate /wayfinding,
// /designer2 must not activate /designer, and platform templates are distinct.
export function getActiveNavigation(
  pathname: string,
  locale: string,
): AppNavItem | undefined {
  const path = getAppPath(pathname, locale);
  return appNavigation
    .flatMap((section) => section.items)
    .filter((item) => path === item.href || path.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
}
