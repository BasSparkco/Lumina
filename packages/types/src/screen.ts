import { z } from 'zod';

export const ScreenStatusSchema = z.enum(['ONLINE', 'OFFLINE']);
export type ScreenStatus = z.infer<typeof ScreenStatusSchema>;

export const ScreenSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: ScreenStatusSchema,
  lastSeenAt: z.string().datetime().nullable(),
  paired: z.boolean(),
  organizationId: z.string(),
  playlistId: z.string().nullable(),
  timezone: z.string(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
});
export type Screen = z.infer<typeof ScreenSchema>;

export const PairingCodeResponseSchema = z.object({
  pairingCode: z.string(),
  expiresAt: z.string().datetime(),
});
export type PairingCodeResponse = z.infer<typeof PairingCodeResponseSchema>;
