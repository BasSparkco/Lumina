import { z } from 'zod';

export const AssetTypeSchema = z.enum(['IMAGE', 'VIDEO', 'AUDIO']);
export type AssetType = z.infer<typeof AssetTypeSchema>;

export const AssetStatusSchema = z.enum(['PROCESSING', 'READY', 'ERROR']);
export type AssetStatus = z.infer<typeof AssetStatusSchema>;

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
  url: z.string().url(),
  thumbnailUrl: z.string().url().nullable(),
  organizationId: z.string(),
  createdAt: z.string().datetime(),
});
export type Asset = z.infer<typeof AssetSchema>;
