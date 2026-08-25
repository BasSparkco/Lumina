import { z } from 'zod';

// Semantic presets only — never arbitrary executable JS. See designer.md §13.
export const AnimationPresetSchema = z.enum([
  'none',
  'fade',
  'fade-up',
  'fade-down',
  'slide-left',
  'slide-right',
  'zoom-in',
  'zoom-out',
  'pulse',
]);
export type AnimationPreset = z.infer<typeof AnimationPresetSchema>;

// Deliberately independent from packages/types' ThemeElementAnimationSchema (different shape,
// different domain — Theme elements vs Design elements). Both should eventually render off the
// same CSS keyframe set in @lumina/ui so editor preview and Player match, but that keyframe
// mapping is later-phase (Player Integration / Animation Runtime) work, not part of this schema.
const AnimationStepSchema = z.object({
  preset: AnimationPresetSchema,
  durationMs: z.number().nonnegative(),
  delayMs: z.number().nonnegative().default(0),
  easing: z.string().optional(),
});

const EmphasisAnimationStepSchema = AnimationStepSchema.extend({
  repeat: z.number().int().positive().optional(),
});

export const ElementAnimationSchema = z.object({
  enter: AnimationStepSchema.optional(),
  emphasis: EmphasisAnimationStepSchema.optional(),
  exit: AnimationStepSchema.optional(),
});
export type ElementAnimation = z.infer<typeof ElementAnimationSchema>;
