import { openDB, type IDBPDatabase } from 'idb';
import type { Playlist, PlayerState } from './api';

const DB_NAME = 'lumina-player';
const DB_VERSION = 4;

export interface ProofOfPlayQueueEntry {
  assetId?: string;
  playedAt: string;
  durationMs: number;
}

interface LuminaDB {
  playlist: { key: 'current'; value: Playlist };
  state: { key: 'current'; value: PlayerState };
  config: { key: string; value: string };
  // Unlike playlist/state (one screen, one current value), a screen can show several live-data
  // zones at once (e.g. two weather widgets for different cities) — each gets its own key so a
  // reboot while offline can restore each zone's own last-known data instead of a shared blob.
  widgetCache: { key: string; value: unknown };
  // aboutlumina-player.md Phase 12 — a durable, append-on-transition/drain-in-batches queue.
  // Autoincrementing numeric keys (not the item id) so a repeated item across a loop, or an
  // identical assetId played twice, still queues as two distinct rows rather than colliding.
  // Durability matters here specifically (unlike kioskAnalytics' fire-and-forget POSTs) —
  // proof-of-play exists for billing/compliance, so a dropped event on a flaky connection isn't
  // acceptable the way a missed "popular search" tick is.
  proofOfPlayQueue: { key: number; value: ProofOfPlayQueueEntry };
}

let db: IDBPDatabase<LuminaDB> | null = null;

async function getDb() {
  if (db) return db;
  db = await openDB<LuminaDB>(DB_NAME, DB_VERSION, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) {
        database.createObjectStore('playlist');
        database.createObjectStore('config');
      }
      if (oldVersion < 2) {
        database.createObjectStore('state');
      }
      if (oldVersion < 3) {
        database.createObjectStore('widgetCache');
      }
      if (oldVersion < 4) {
        database.createObjectStore('proofOfPlayQueue', { autoIncrement: true });
      }
    },
  });
  return db;
}

export const cache = {
  async savePlaylist(playlist: Playlist) {
    const database = await getDb();
    await database.put('playlist', playlist, 'current');
  },
  async getPlaylist(): Promise<Playlist | undefined> {
    const database = await getDb();
    return (await database.get('playlist', 'current')) as Playlist | undefined;
  },
  async set(key: string, value: string) {
    const database = await getDb();
    await database.put('config', value, key);
  },
  async get(key: string): Promise<string | undefined> {
    const database = await getDb();
    return (await database.get('config', key)) as string | undefined;
  },
  async saveState(state: PlayerState) {
    const database = await getDb();
    await database.put('state', state, 'current');
  },
  async getState(): Promise<PlayerState | undefined> {
    const database = await getDb();
    return (await database.get('state', 'current')) as PlayerState | undefined;
  },
  async getWidgetData<T>(key: string): Promise<T | undefined> {
    const database = await getDb();
    return (await database.get('widgetCache', key)) as T | undefined;
  },
  async saveWidgetData<T>(key: string, value: T) {
    const database = await getDb();
    await database.put('widgetCache', value, key);
  },
  async clear() {
    const database = await getDb();
    await database.clear('playlist');
    await database.clear('state');
    await database.clear('config');
    await database.clear('widgetCache');
  },
  async enqueueProofOfPlay(entry: ProofOfPlayQueueEntry) {
    const database = await getDb();
    await database.add('proofOfPlayQueue', entry);
  },
  async getProofOfPlayQueue(): Promise<{ key: number; entry: ProofOfPlayQueueEntry }[]> {
    const database = await getDb();
    const keys = await database.getAllKeys('proofOfPlayQueue');
    const entries = (await database.getAll('proofOfPlayQueue')) as ProofOfPlayQueueEntry[];
    return keys.map((key, i) => ({ key: key as number, entry: entries[i]! }));
  },
  async deleteProofOfPlayEntries(keys: number[]) {
    const database = await getDb();
    const tx = database.transaction('proofOfPlayQueue', 'readwrite');
    await Promise.all([...keys.map((key) => tx.store.delete(key)), tx.done]);
  },
};
