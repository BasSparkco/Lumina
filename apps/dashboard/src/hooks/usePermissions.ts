import { useAuth } from '@/context/AuthContext';
import type { UserRole } from '@/lib/api';

const RANK: Record<UserRole, number> = { VIEWER: 0, EDITOR: 1, ADMIN: 2, OWNER: 3 };

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
  };
}
