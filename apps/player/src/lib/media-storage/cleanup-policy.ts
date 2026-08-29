import type { CleanupPolicy } from './types';

export interface CleanupCandidate {
  storageKey: string;
  fileSize: number;
  lastUsedAt: number;
}

export interface CleanupPlan {
  removedStorageKeys: string[];
  removedBytes: number;
  remainingBytes: number;
}

/** Pure LRU/age planner; physical deletion remains the OPFS adapter's responsibility. */
export function planMediaCleanup(
  candidates: readonly CleanupCandidate[],
  policy: CleanupPolicy,
  activeStorageKeys: ReadonlySet<string>,
  now = Date.now(),
): CleanupPlan {
  const retain = policy.retainStorageKeys ?? new Set<string>();
  const ordered = [...candidates].sort((a, b) => a.lastUsedAt - b.lastUsedAt);
  let remainingBytes = ordered.reduce((total, record) => total + record.fileSize, 0);
  let removedBytes = 0;
  const removedStorageKeys: string[] = [];

  for (const record of ordered) {
    const tooOld = policy.maxUnusedMs !== undefined
      && now - record.lastUsedAt > policy.maxUnusedMs;
    const tooLarge = policy.maxMediaBytes !== undefined
      && remainingBytes > policy.maxMediaBytes;
    if ((!tooOld && !tooLarge) || retain.has(record.storageKey) || activeStorageKeys.has(record.storageKey)) continue;
    remainingBytes -= record.fileSize;
    removedBytes += record.fileSize;
    removedStorageKeys.push(record.storageKey);
  }

  return { removedStorageKeys, removedBytes, remainingBytes };
}
