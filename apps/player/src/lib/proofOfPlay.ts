// Proof-of-play buffering/flush (aboutlumina-player.md Phase 12 — "build, don't just port").
// apps/api's POST /player/proof-of-play + query/export endpoints have existed since before this
// file did, with zero callers anywhere in this app — the dashboard's Reports page read a
// per-browser localStorage mock instead (docs/tenant_isolation_and_platform_admin_plan.md P8).
// Unlike kioskAnalytics' fire-and-forget POSTs, durability matters here: proof-of-play exists
// for billing/compliance, so recordPlay() always writes to the durable IndexedDB queue first
// (db.ts's proofOfPlayQueue store) — a flush only ever deletes a row after the server has
// actually acknowledged it, so a lost connection mid-flush re-sends on the next attempt instead
// of silently dropping the event.
import { api } from './api';
import { cache } from './db';
import { shouldAttemptNetwork } from './connectivity';

// Mirrors IngestProofOfPlayDto's @ArrayMaxSize(500) — a single flush never sends more than the
// server will accept in one request; a queue larger than that (e.g. after an extended outage)
// drains over several flush cycles instead of failing the whole batch.
const MAX_BATCH_SIZE = 500;

export function recordPlay(assetId: string | undefined, playedAt: Date, durationMs: number) {
  if (durationMs <= 0) return;
  void cache.enqueueProofOfPlay({ assetId, playedAt: playedAt.toISOString(), durationMs }).catch(() => {
    /* best-effort — an IndexedDB write failure here shouldn't interrupt playback */
  });
}

let flushInProgress = false;

// Called from PlayerPage's existing heartbeat cycle rather than its own interval — see
// aboutlumina-player.md's own suggested design ("next scheduled heartbeat cycle batches queued
// rows"). Re-entrancy-guarded since a slow flush must not overlap the next heartbeat tick.
export async function flushProofOfPlay(): Promise<void> {
  if (flushInProgress || !shouldAttemptNetwork()) return;
  flushInProgress = true;
  try {
    const queued = await cache.getProofOfPlayQueue();
    if (queued.length === 0) return;
    const batch = queued.slice(0, MAX_BATCH_SIZE);
    await api.ingestProofOfPlay(batch.map((q) => q.entry));
    await cache.deleteProofOfPlayEntries(batch.map((q) => q.key));
  } catch {
    // Leave queued rows in place — retried on the next heartbeat cycle. Never throws: a failed
    // flush must not interrupt the heartbeat it's piggybacking on.
  } finally {
    flushInProgress = false;
  }
}
