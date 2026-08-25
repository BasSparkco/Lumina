import { z } from 'zod';

// designer.md §9 — the only way an element may reference uploaded media. No `src`/`data` field
// exists on this shape at all, which structurally rules out embedding base64 payloads: the API
// and Player always resolve `assetId` to a signed/CDN URL themselves.
export const MediaReferenceSchema = z.object({
  assetId: z.string(),
  source: z.object({
    kind: z.literal('mediaAsset'),
    id: z.string(),
  }),
});
export type MediaReference = z.infer<typeof MediaReferenceSchema>;
