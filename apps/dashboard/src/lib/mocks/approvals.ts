// Mock for the Phase 5 "content approval workflow" contract (editor submits → admin
// approves). Playlists themselves are a real backend entity (see lib/api.ts) — only the
// approval-status overlay is mocked here, keyed by playlist id, until the backend track
// ships real submit/approve/reject endpoints and a status column on Playlist. Swap this
// module for a real `req<T>()`-backed client once that lands; the call shape below is
// designed to match one-for-one so that's a small diff, not a rewrite.

export type ApprovalStatus = 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED';

export const APPROVAL_STATUS_STYLES: Record<ApprovalStatus, string> = {
  DRAFT: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400',
  PENDING: 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300',
  APPROVED: 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300',
  REJECTED: 'bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300',
};

export interface ApprovalRecord {
  playlistId: string;
  status: ApprovalStatus;
  submittedByName?: string;
  submittedAt?: string;
  reviewedByName?: string;
  reviewedAt?: string;
  comment?: string;
}

const STORAGE_KEY = 'lumina_mock_approvals';
const SETTINGS_KEY = 'lumina_mock_approval_settings';

export interface ApprovalSettings {
  /** Whether playlists must go through submit → approve/reject before counting as approved.
   * Turning this off doesn't erase any playlist's actual review history (a playlist that was
   * explicitly submitted/approved/rejected keeps that record) — it only changes the *default*
   * for playlists with no record yet, from DRAFT to APPROVED, so nothing new requires review
   * while it's off. */
  required: boolean;
}

// Persisted to localStorage (not just an in-memory variable) so status survives a full
// page reload — a plain module variable resets on every navigation since each page load
// re-runs this file.
function loadRecords(): Record<string, ApprovalRecord> {
  if (typeof window === 'undefined') return {};
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw ? (JSON.parse(raw) as Record<string, ApprovalRecord>) : {};
}

function saveRecords(data: Record<string, ApprovalRecord>) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function loadSettings(): ApprovalSettings {
  if (typeof window === 'undefined') return { required: true };
  const raw = window.localStorage.getItem(SETTINGS_KEY);
  return raw ? (JSON.parse(raw) as ApprovalSettings) : { required: true };
}

function saveSettings(settings: ApprovalSettings) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

let records: Record<string, ApprovalRecord> = loadRecords();

const delay = (ms = 300) => new Promise(resolve => setTimeout(resolve, ms));

function getOrDefault(playlistId: string): ApprovalRecord {
  return records[playlistId] ?? { playlistId, status: 'DRAFT' };
}

/** Every page derives a playlist's displayed status from `approvals[id]?.status` with a
 * fallback for playlists that have no record yet — use this instead of hardcoding that
 * fallback, so the "approvals disabled" setting is honored consistently everywhere (a
 * playlist with no explicit record reads as APPROVED while the setting is off, DRAFT while
 * it's on; a playlist with an explicit PENDING/APPROVED/REJECTED record always keeps it,
 * regardless of the setting). */
export function statusOf(record: ApprovalRecord | undefined, settings: ApprovalSettings): ApprovalStatus {
  return record?.status ?? (settings.required ? 'DRAFT' : 'APPROVED');
}

export const approvalsApi = {
  listAll: async (): Promise<Record<string, ApprovalRecord>> => {
    await delay();
    records = loadRecords();
    return { ...records };
  },
  get: async (playlistId: string): Promise<ApprovalRecord> => {
    await delay();
    records = loadRecords();
    return getOrDefault(playlistId);
  },
  getSettings: async (): Promise<ApprovalSettings> => {
    await delay();
    return loadSettings();
  },
  updateSettings: async (settings: ApprovalSettings): Promise<ApprovalSettings> => {
    await delay();
    saveSettings(settings);
    return settings;
  },
  submit: async (playlistId: string, submittedByName: string): Promise<ApprovalRecord> => {
    await delay();
    records = loadRecords();
    const record: ApprovalRecord = {
      playlistId, status: 'PENDING', submittedByName, submittedAt: new Date().toISOString(),
    };
    records = { ...records, [playlistId]: record };
    saveRecords(records);
    return record;
  },
  approve: async (playlistId: string, reviewedByName: string): Promise<ApprovalRecord> => {
    await delay();
    records = loadRecords();
    const record: ApprovalRecord = {
      ...getOrDefault(playlistId), status: 'APPROVED', reviewedByName, reviewedAt: new Date().toISOString(), comment: undefined,
    };
    records = { ...records, [playlistId]: record };
    saveRecords(records);
    return record;
  },
  reject: async (playlistId: string, reviewedByName: string, comment: string): Promise<ApprovalRecord> => {
    await delay();
    records = loadRecords();
    const record: ApprovalRecord = {
      ...getOrDefault(playlistId), status: 'REJECTED', reviewedByName, reviewedAt: new Date().toISOString(), comment,
    };
    records = { ...records, [playlistId]: record };
    saveRecords(records);
    return record;
  },
};
