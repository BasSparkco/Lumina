import { openDB, type IDBPDatabase } from 'idb';
import type { Playlist, PlayerState } from './api';

const DB_NAME = 'lumina-player';
const DB_VERSION = 2;

interface LuminaDB {
  playlist: { key: 'current'; value: Playlist };
  state: { key: 'current'; value: PlayerState };
  config: { key: string; value: string };
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
    return database.get('playlist', 'current');
  },
  async set(key: string, value: string) {
    const database = await getDb();
    await database.put('config', value, key);
  },
  async get(key: string): Promise<string | undefined> {
    const database = await getDb();
    return database.get('config', key);
  },
  async saveState(state: PlayerState) {
    const database = await getDb();
    await database.put('state', state, 'current');
  },
  async getState(): Promise<PlayerState | undefined> {
    const database = await getDb();
    return database.get('state', 'current');
  },
  async clear() {
    const database = await getDb();
    await database.clear('playlist');
    await database.clear('state');
    await database.clear('config');
  },
};
