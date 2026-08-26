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

// This package has no DOM or @types/node dependency (it's meant to be portable to both the
// browser and Node), so the ambient `crypto` global (available in both — Node 20+, which every
// runtime in this monorepo already targets — and every browser) needs a minimal local type
// rather than pulling in either lib.
declare const crypto: { randomUUID(): string };

// designer.md Phase 10 — a fresh, valid single-scene document, shared by every place that needs
// to bootstrap one from nothing: designer2/page.tsx's blank-editor mode, TemplatesService's
// admin-create-with-no-designJson, and DesignsService's POST /designs. Previously duplicated
// (near-identically) in the first two; a third copy for designs.service.ts was the trigger to
// unify them.
export function buildBlankDesignDocument(name: string): DesignDocument {
  return {
    schemaVersion: 1,
    id: `design_${crypto.randomUUID()}`,
    name,
    canvas: { width: 1920, height: 1080, backgroundColor: '#000000' },
    settings: { defaultSceneDurationMs: 10000 },
    scenes: [
      {
        id: `scene_${crypto.randomUUID()}`,
        name: 'Scene 1',
        durationMs: 10000,
        background: { type: 'color', color: '#000000' },
        elements: [],
      },
    ],
  };
}
