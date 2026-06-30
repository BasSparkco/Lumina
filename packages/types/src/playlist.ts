import { z } from 'zod';
import { AssetSchema } from './asset';

export const PlaylistItemSchema = z.object({
  id: z.string(),
  position: z.number().int(),
  durationSecs: z.number().int(),
  asset: AssetSchema,
});
export type PlaylistItem = z.infer<typeof PlaylistItemSchema>;

export const PlaylistSchema = z.object({
  id: z.string(),
  name: z.string(),
  organizationId: z.string(),
  items: z.array(PlaylistItemSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Playlist = z.infer<typeof PlaylistSchema>;
