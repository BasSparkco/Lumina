'use client';
import { useQueryClient } from '@tanstack/react-query';
import { auditLogApi, type AuditLogEntry } from '@/lib/mocks/auditLog';

/** Records an audit-log entry and pushes it straight into the `['auditLog']` query cache,
 * so every call site updates the visible log immediately instead of waiting on a
 * background refetch that an invalidation alone would depend on. Also invalidates, so a
 * fresh mount of the Audit Log page still gets a real fetch rather than only ever trusting
 * the optimistic cache write. */
export function useAuditLog() {
  const qc = useQueryClient();
  return (entry: Omit<AuditLogEntry, 'id' | 'timestamp'>) => {
    const full = auditLogApi.record(entry);
    qc.setQueryData<AuditLogEntry[]>(['auditLog'], (old) => (old ? [full, ...old] : [full]));
    void qc.invalidateQueries({ queryKey: ['auditLog'] });
  };
}
