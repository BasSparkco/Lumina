import { useAuth } from '@/context/AuthContext';
import type { UserRole } from '@/lib/api';

const RANK: Record<UserRole, number> = { VIEWER: 0, EDITOR: 1, ADMIN: 2, OWNER: 3 };

export function usePermissions() {
  const { user } = useAuth();
  const role = user?.role ?? 'VIEWER';
  const isSuperAdmin = user?.isSuperAdmin ?? false;

  return {
    role,
    isViewer: role === 'VIEWER',
    canEditContent: RANK[role] >= RANK.EDITOR,
    canManageMembers: RANK[role] >= RANK.ADMIN,
    canManageBilling: RANK[role] >= RANK.ADMIN,
    canApproveContent: RANK[role] >= RANK.ADMIN,
    canViewAuditLog: RANK[role] >= RANK.ADMIN,
    // Shared-library authority is platform authority, not a tenant role (P3,
    // docs/tenant_isolation_and_platform_admin_plan.md §2.6) — no tenant role, including OWNER,
    // grants it; only the cross-tenant Super Admin flag does.
    canManageLibrary: isSuperAdmin,
    // Cross-tenant platform flag, unrelated to this org's role ladder entirely.
    isSuperAdmin,
  };
}
