import { describe, expect, it, vi } from 'vitest';
import { getActiveNavigation, getVisibleNavigation } from '../appNavigation';

const owner = {
  role: 'OWNER' as const,
  isViewer: false,
  canEditContent: true,
  canManageMembers: true,
  canManageBilling: true,
  canApproveContent: true,
  canViewAuditLog: true,
  canManageLibrary: false,
  isSuperAdmin: false,
};
const links = (sections: ReturnType<typeof getVisibleNavigation>) =>
  sections.flatMap((section) => section.items.map((item) => item.href));

describe('Signal navigation boundaries', () => {
  it.each([
    ['/en/designer2', 'en', '/designer2'],
    ['/ar/wayfinding/ai', 'ar', '/wayfinding/ai'],
    ['/en/admin/templates', 'en', '/admin/templates'],
    ['/ar/admin/tenants/tenant-123', 'ar', '/admin/tenants'],
    ['/en/screens/', 'en', '/screens'],
    ['/en/screens-other', 'en', undefined],
  ])('uses one segment-aware active item for %s', (path, locale, expected) => {
    expect(getActiveNavigation(path, locale)?.href).toBe(expected);
  });

  it('does not expose platform authority to a tenant owner, or reveal billing', () => {
    const sections = getVisibleNavigation(owner, () => true, false);
    expect(
      sections.find((section) => section.key === 'platform'),
    ).toBeUndefined();
    expect(links(sections)).not.toContain('/billing');
    expect(links(sections)).toContain('/members');
  });

  it('separates platform authority from the tenant role', () => {
    const sections = getVisibleNavigation(
      {
        ...owner,
        role: 'VIEWER',
        isViewer: true,
        canEditContent: false,
        canManageMembers: false,
        canViewAuditLog: false,
        canApproveContent: false,
        isSuperAdmin: true,
        canManageLibrary: true,
      },
      () => false,
      false,
    );
    expect(
      sections
        .find((section) => section.key === 'platform')
        ?.items.map((item) => item.href),
    ).toEqual(['/admin/templates', '/admin/tenants']);
    expect(links(sections)).not.toContain('/members');
    expect(links(sections)).not.toContain('/audit-log');
  });

  it('hides every gated module until capabilities resolve, without calling the resolver', () => {
    const hasModule = vi.fn(() => true);
    const sections = getVisibleNavigation(owner, hasModule, true);
    expect(hasModule).not.toHaveBeenCalled();
    expect(
      sections.find((section) => section.key === 'operations'),
    ).toBeUndefined();
  });

  it('uses the existing resolver separately for AI, Wayfinding and Room Booking', () => {
    const sections = getVisibleNavigation(
      owner,
      (module) => module === 'ROOM_BOOKING',
      false,
    );
    expect(links(sections)).toContain('/room-booking');
    expect(links(sections)).not.toContain('/wayfinding');
    expect(links(sections)).not.toContain('/wayfinding/ai');
    expect(links(sections)).toContain('/designer');
    expect(links(sections)).toContain('/designer2');
  });
});
