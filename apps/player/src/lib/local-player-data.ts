import { cache } from './db';
import { clearAllPersistentMedia, getActiveMediaStorage } from './media-storage';
import { disposeBrowserMediaDownloadManager } from './media-sync';

/** Clear both small player state and large persistent binaries for unpair/reset operations. */
export async function clearLocalPlayerData(): Promise<void> {
  const activeStorage = getActiveMediaStorage();
  if (activeStorage) disposeBrowserMediaDownloadManager(activeStorage);
  const cacheStorageCleanup = 'caches' in window
    ? caches.keys().then(keys => Promise.all(keys.map(key => caches.delete(key)))).then(() => undefined)
    : Promise.resolve();
  const results = await Promise.allSettled([cache.clear(), clearAllPersistentMedia(), cacheStorageCleanup]);
  const failures = results.filter(result => result.status === 'rejected');
  if (failures.length > 0) {
    // Identity changes must still complete if storage was externally evicted or became
    // unavailable. Namespaced media cannot be reused by a new screen identity, and the next
    // startup reconciliation gets another chance to remove any physical orphan.
    console.warn('[local-player-data] cleanup incomplete', failures);
  }
}
