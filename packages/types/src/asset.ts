import { z } from 'zod';

export const AssetTypeSchema = z.enum(['IMAGE', 'VIDEO', 'AUDIO']);
export type AssetType = z.infer<typeof AssetTypeSchema>;

export const AssetStatusSchema = z.enum(['PROCESSING', 'READY', 'ERROR']);
export type AssetStatus = z.infer<typeof AssetStatusSchema>;

export const AssetCategorySchema = z.enum([
  'BACKGROUND',
  'ICON',
  'ILLUSTRATION',
  'STOCK_PHOTO',
  'LOGO',
  'VIDEO_LOOP',
  'AUDIO_JINGLE',
  'GENERIC',
]);
export type AssetCategory = z.infer<typeof AssetCategorySchema>;

export const AssetSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: AssetTypeSchema,
  mimeType: z.string(),
  sizeBytes: z.number(),
  durationSecs: z.number().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  status: AssetStatusSchema,
  category: AssetCategorySchema,
  tags: z.array(z.string()),
  url: z.string().url(),
  thumbnailUrl: z.string().url().nullable(),
  // null = a stock library asset (organizationId: null) — see the Asset model comment in
  // schema.prisma. Orgs copy these into their own library before use.
  organizationId: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type Asset = z.infer<typeof AssetSchema>;
