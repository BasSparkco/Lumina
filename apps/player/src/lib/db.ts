import { openDB, type IDBPDatabase } from 'idb';
import type { Playlist, PlayerState } from './api';

const DB_NAME = 'lumina-player';
const DB_VERSION = 3;

interface LuminaDB {
  playlist: { key: 'current'; value: Playlist };
  state: { key: 'current'; value: PlayerState };
  config: { key: string; value: string };
  // Unlike playlist/state (one screen, one current value), a screen can show several live-data
  // zones at once (e.g. two weather widgets for different cities) — each gets its own key so a
  // reboot while offline can restore each zone's own last-known data instead of a shared blob.
  widgetCache: { key: string; value: unknown };
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
};
