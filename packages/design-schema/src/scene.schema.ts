import { z } from 'zod';
import { DesignElementSchema } from './element.schema';

// designer.md §18.2
const SceneBackgroundSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('color'), color: z.string() }),
  z.object({ type: z.literal('image'), assetId: z.string() }),
  z.object({ type: z.literal('video'), assetId: z.string() }),
]);
export type SceneBackground = z.infer<typeof SceneBackgroundSchema>;

export const DesignSceneSchema = z.object({
  id: z.string(),
  name: z.string(),
  durationMs: z.number().positive(),
  background: SceneBackgroundSchema,
  elements: z.array(DesignElementSchema),
});
export type DesignScene = z.infer<typeof DesignSceneSchema>;
