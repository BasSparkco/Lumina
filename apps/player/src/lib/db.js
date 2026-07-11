import { openDB } from 'idb';
const DB_NAME = 'lumina-player';
const DB_VERSION = 2;
let db = null;
async function getDb() {
    if (db)
        return db;
    db = await openDB(DB_NAME, DB_VERSION, {
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
    async savePlaylist(playlist) {
        const database = await getDb();
        await database.put('playlist', playlist, 'current');
    },
    async getPlaylist() {
        const database = await getDb();
        return (await database.get('playlist', 'current'));
    },
    async set(key, value) {
        const database = await getDb();
        await database.put('config', value, key);
    },
    async get(key) {
        const database = await getDb();
        return (await database.get('config', key));
    },
    async saveState(state) {
        const database = await getDb();
        await database.put('state', state, 'current');
    },
    async getState() {
        const database = await getDb();
        return (await database.get('state', 'current'));
    },
    async clear() {
        const database = await getDb();
        await database.clear('playlist');
        await database.clear('state');
        await database.clear('config');
    },
};
//# sourceMappingURL=db.js.map