import { z } from 'zod';
import type { ModuleKey } from './modules';

// Per-module offline access lease attached to a player's state payload — bounds how long a
// player may keep rendering a paid module's content from a cached/offline snapshot after its
// last successful live fetch. Deliberately generic (keyed by ModuleKey) rather than a
// Wayfinding-only field, so a future player-facing module can reuse the same contract. Not
// itself tamper-resistant against a customer who controls the device/browser/clock — see
// docs/adr/platform-modules-and-entitlements.md.
export interface PlayerModuleLease {
  key: ModuleKey;
  issuedAt: string;
  validUntil: string;
}

// Commands pushed from API → player over WebSocket
export const PlayerCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('PUBLISH'), playlistId: z.string() }),
  z.object({ type: z.literal('RELOAD') }),
  z.object({ type: z.literal('CLEAR_CACHE') }),
  z.object({ type: z.literal('REBOOT') }),
]);
export type PlayerCommand = z.infer<typeof PlayerCommandSchema>;

// Heartbeat sent from player → API
export const HeartbeatPayloadSchema = z.object({
  screenId: z.string(),
  currentPlaylistId: z.string().nullable(),
  currentAssetId: z.string().nullable(),
  timestamp: z.string().datetime(),
});
export type HeartbeatPayload = z.infer<typeof HeartbeatPayloadSchema>;
