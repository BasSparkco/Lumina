import { useAuth } from '@/context/AuthContext';
import type { UserRole } from '@/lib/api';

// LIBRARY_MANAGER sits at the same tier as VIEWER here — it's a library-only role, not a step on
// the generic content-editing ladder, so it must not pick up EDITOR/ADMIN rights via RANK.
const RANK: Record<UserRole, number> = { VIEWER: 0, LIBRARY_MANAGER: 0, EDITOR: 1, ADMIN: 2, OWNER: 3 };

export function usePermissions() {
  const { user } = useAuth();
  const role = user?.role ?? 'VIEWER';

  return {
    role,
    isViewer: role === 'VIEWER',
    canEditContent: RANK[role] >= RANK.EDITOR,
    canManageMembers: RANK[role] >= RANK.ADMIN,
    canManageBilling: RANK[role] >= RANK.ADMIN,
    canApproveContent: RANK[role] >= RANK.ADMIN,
    canViewAuditLog: RANK[role] >= RANK.ADMIN,
    // Orthogonal to the rank ladder above, not a step on it — explicit role check rather than RANK.
    canManageLibrary: role === 'LIBRARY_MANAGER',
    // Cross-tenant platform flag, unrelated to this org's role ladder entirely.
    isSuperAdmin: user?.isSuperAdmin ?? false,
  };
}
