// Mock for the Phase 5 "Audit log" contract — there's no `AuditLog` model or endpoint on
// the backend yet, so entries are recorded client-side (localStorage) from the dashboard's
// own mutations (see `hooks/useAuditLog.ts`, used across Members/Playlists/Screens/Assets/
// Layouts/Schedules/Approvals). Swap for a real `req<T>()`-backed client once the backend
// track ships real server-side audit logging — that's the only way to *actually* guarantee
// every change is captured, including ones made directly against the API rather than
// through this dashboard.

export type AuditResourceType = 'MEMBER' | 'PLAYLIST' | 'SCREEN' | 'ASSET' | 'LAYOUT' | 'SCHEDULE' | 'GROUP';
export type AuditAction =
  | 'CREATE' | 'UPDATE' | 'DELETE'
  | 'INVITE' | 'ROLE_CHANGE' | 'REMOVE'
  | 'SUBMIT' | 'APPROVE' | 'REJECT'
  | 'ADD_ITEM' | 'REMOVE_ITEM';

export interface AuditLogEntry {
  id: string;
  resourceType: AuditResourceType;
  resourceName: string;
  action: AuditAction;
  userName: string;
  userEmail: string;
  timestamp: string;
  /** For INVITE/ROLE_CHANGE this is a UserRole code (e.g. "VIEWER"), translated at render
   * time via `common.roles` — never a pre-built English sentence, so it still reads right
   * after a locale switch. For REJECT it's the reviewer's own freeform comment, which is
   * left as-is regardless of locale since it's arbitrary human-authored text. */
  detail?: string;
}

export const AUDIT_ACTION_STYLES: Record<AuditAction, string> = {
  CREATE: 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300',
  INVITE: 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300',
  APPROVE: 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300',
  ADD_ITEM: 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300',
  UPDATE: 'bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300',
  ROLE_CHANGE: 'bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300',
  SUBMIT: 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300',
  DELETE: 'bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300',
  REMOVE: 'bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300',
  REJECT: 'bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300',
  REMOVE_ITEM: 'bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300',
};

const STORAGE_KEY = 'lumina_mock_audit_log';

const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString();

const SEED: AuditLogEntry[] = [
  { id: 'a1', resourceType: 'MEMBER', resourceName: 'karim@example.com', action: 'INVITE', userName: 'Sara Ahmed', userEmail: 'sara@example.com', timestamp: daysAgo(30), detail: 'EDITOR' },
  { id: 'a2', resourceType: 'SCREEN', resourceName: 'Lobby', action: 'CREATE', userName: 'Admin User', userEmail: 'admin@demo.com', timestamp: daysAgo(28) },
  { id: 'a3', resourceType: 'PLAYLIST', resourceName: 'Breakfast menu', action: 'CREATE', userName: 'Karim Youssef', userEmail: 'karim@example.com', timestamp: daysAgo(14) },
  { id: 'a4', resourceType: 'SCHEDULE', resourceName: 'Breakfast menu', action: 'CREATE', userName: 'Karim Youssef', userEmail: 'karim@example.com', timestamp: daysAgo(14) },
  { id: 'a5', resourceType: 'MEMBER', resourceName: 'layla@example.com', action: 'ROLE_CHANGE', userName: 'Sara Ahmed', userEmail: 'sara@example.com', timestamp: daysAgo(7), detail: 'VIEWER' },
];

function loadLog(): AuditLogEntry[] {
  if (typeof window === 'undefined') return SEED;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw ? (JSON.parse(raw) as AuditLogEntry[]) : SEED;
}

function saveLog(data: AuditLogEntry[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

let log: AuditLogEntry[] = loadLog();

const delay = (ms = 300) => new Promise(resolve => setTimeout(resolve, ms));

export const auditLogApi = {
  list: async (): Promise<AuditLogEntry[]> => {
    await delay();
    log = loadLog();
    return [...log].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  },
  /** Fire-and-forget: called from other pages' mutation `onSuccess` handlers, not awaited
   * directly by the UI, so it stays synchronous rather than round-tripping through `delay()`.
   * Returns the entry it just wrote so the caller can push it straight into the query cache
   * instead of waiting on a background refetch to notice the change. */
  record: (entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): AuditLogEntry => {
    log = loadLog();
    const full: AuditLogEntry = { ...entry, id: `a-${Math.random().toString(36).slice(2, 10)}`, timestamp: new Date().toISOString() };
    log = [full, ...log];
    saveLog(log);
    return full;
  },
};
