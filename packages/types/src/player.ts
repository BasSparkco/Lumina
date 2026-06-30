import { z } from 'zod';

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
