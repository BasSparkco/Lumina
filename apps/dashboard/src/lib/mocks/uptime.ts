// Mock for the Phase 5 "Fleet monitoring" uptime % — there's no historical online/offline log
// anywhere (`Screen` only stores its current `status` + `lastSeenAt`, never a history of state
// changes), so a real long-window uptime percentage can't be computed from real data. Live status
// and last-seen ARE real (see the Fleet page's own staleness check over `Screen.lastSeenAt` plus
// `useScreenSocket`'s live push); only this percentage is synthesized, seeded once per real screen
// id and persisted so it stays stable across visits instead of reshuffling on every reload.

const STORAGE_KEY = 'lumina_mock_uptime';

type UptimeMap = Record<string, number>;

function load(): UptimeMap {
  if (typeof window === 'undefined') return {};
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw ? (JSON.parse(raw) as UptimeMap) : {};
}

function save(data: UptimeMap) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function getUptimePercents(screenIds: string[]): UptimeMap {
  const map = load();
  let changed = false;
  for (const id of screenIds) {
    if (map[id] === undefined) {
      map[id] = Math.round((92 + Math.random() * 7.9) * 10) / 10;
      changed = true;
    }
  }
  if (changed) save(map);
  return map;
}
