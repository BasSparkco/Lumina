import { z } from 'zod';
import { DesignSceneSchema } from './scene.schema';

// designer.md §18.2/§18.4 — the canonical, Lumina-owned persistence and API contract. Never
// raw fabric.Canvas.toJSON(). schemaVersion is a literal today; a future breaking change bumps
// it and ships a documented migration function (packages/design-schema/migrations/, reserved
// convention, not built until a schema break actually happens).
export const DesignDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  name: z.string(),

  canvas: z.object({
    width: z.number().positive(),
    height: z.number().positive(),
    backgroundColor: z.string(),
  }),

  settings: z.object({
    defaultSceneDurationMs: z.number().positive(),
  }),

  variables: z.record(z.string(), z.string()).optional(),

  scenes: z.array(DesignSceneSchema).min(1),
});
export type DesignDocument = z.infer<typeof DesignDocumentSchema>;
