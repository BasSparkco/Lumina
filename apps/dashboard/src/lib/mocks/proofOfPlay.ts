// Mock for the Phase 5 "Proof-of-play reporting" contract — there's no `ProofOfPlayLog` model
// or endpoint on the backend yet (the player app doesn't emit any playback telemetry at all
// currently, see apps/player/src/components/ZonePlayer.tsx). Swap for a real `req<T>()`-backed
// client once the backend/player tracks actually record plays server-side.
//
// Unlike the other mocks (audit log, approvals), there's no dashboard mutation to hang this
// off of — a play event happens on a physical screen, not in this app. So instead of recording
// entries as the user acts, this generates a plausible-looking history once (seeded from
// whichever real screens/assets/playlists exist in the org at generation time, so the screen
// filter dropdown actually has matching data) and persists it to localStorage, exactly like a
// snapshot of "already-collected" history would look once the backend ships.

export interface ProofOfPlayEntry {
  id: string;
  screenId: string;
  screenName: string;
  assetId: string;
  assetName: string;
  playlistId: string;
  playlistName: string;
  playedAt: string;
  durationSecs: number;
}

const STORAGE_KEY = 'lumina_mock_proof_of_play';
const DAYS_BACK = 14;
const MIN_PLAYS_PER_SCREEN_PER_DAY = 4;
const MAX_PLAYS_PER_SCREEN_PER_DAY = 11;

function loadLog(): ProofOfPlayEntry[] | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw ? (JSON.parse(raw) as ProofOfPlayEntry[]) : null;
}

function saveLog(data: ProofOfPlayEntry[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function generate(
  screens: { id: string; name: string }[],
  assets: { id: string; name: string }[],
  playlists: { id: string; name: string }[],
): ProofOfPlayEntry[] {
  const entries: ProofOfPlayEntry[] = [];
  let n = 0;
  for (let daysAgo = 0; daysAgo < DAYS_BACK; daysAgo++) {
    for (const screen of screens) {
      const playCount = MIN_PLAYS_PER_SCREEN_PER_DAY + Math.floor(Math.random() * (MAX_PLAYS_PER_SCREEN_PER_DAY - MIN_PLAYS_PER_SCREEN_PER_DAY));
      for (let i = 0; i < playCount; i++) {
        const asset = assets[Math.floor(Math.random() * assets.length)];
        if (!asset) continue;
        const playlist = playlists.length > 0 ? playlists[Math.floor(Math.random() * playlists.length)] : null;
        const playedAt = new Date(Date.now() - daysAgo * 86400000);
        playedAt.setHours(Math.floor(Math.random() * 24), Math.floor(Math.random() * 60), 0, 0);
        entries.push({
          id: `pop-${n++}`,
          screenId: screen.id, screenName: screen.name,
          assetId: asset.id, assetName: asset.name,
          playlistId: playlist?.id ?? '', playlistName: playlist?.name ?? '',
          playedAt: playedAt.toISOString(),
          durationSecs: 8 + Math.floor(Math.random() * 22),
        });
      }
    }
  }
  return entries;
}

const delay = (ms = 300) => new Promise(resolve => setTimeout(resolve, ms));

export const proofOfPlayApi = {
  list: async (
    screens: { id: string; name: string }[],
    assets: { id: string; name: string }[],
    playlists: { id: string; name: string }[],
  ): Promise<ProofOfPlayEntry[]> => {
    await delay();
    let log = loadLog();
    if (!log) {
      log = screens.length > 0 && assets.length > 0 ? generate(screens, assets, playlists) : [];
      saveLog(log);
    }
    return [...log].sort((a, b) => b.playedAt.localeCompare(a.playedAt));
  },
};
