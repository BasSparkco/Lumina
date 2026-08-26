import type { AnimationPreset } from '../animation.schema';

// designer.md §13 — the semantic definition of every preset, framework-agnostic. This is the one
// place "enter/exit/emphasis all mean the same thing" is defined — consumed by both the Designer
// (FabricCanvasAdapter, Fabric-native tweens) and the Player (DesignRenderer, Web Animations API)
// so the two never silently disagree on what a preset looks like. Moved here from
// apps/dashboard/src/features/designer2/runtime/animations.ts in designer.md Phase 11 — that
// file's own doc comment said a future Player runtime should reuse this table, not redefine it.
export const SLIDE_DISTANCE_PX = 60;

export interface AnimationMotion {
  // Absolute opacity at the "away" state. Omitted = opacity untouched by this preset.
  opacityAway?: number;
  // Pixel offset applied to the resting position at the "away" state. Canvas y is down, so a
  // positive dy starts below rest (a "fade-up" enter moves up into place, matching the naming).
  dx?: number;
  dy?: number;
  // Multiplier applied to the resting scaleX/scaleY at the "away" state.
  scaleAway?: number;
}

export const ANIMATION_MOTION: Record<AnimationPreset, AnimationMotion> = {
  none: {},
  fade: { opacityAway: 0 },
  'fade-up': { opacityAway: 0, dy: SLIDE_DISTANCE_PX },
  'fade-down': { opacityAway: 0, dy: -SLIDE_DISTANCE_PX },
  'slide-left': { dx: SLIDE_DISTANCE_PX },
  'slide-right': { dx: -SLIDE_DISTANCE_PX },
  'zoom-in': { opacityAway: 0, scaleAway: 0.85 },
  'zoom-out': { opacityAway: 0, scaleAway: 1.15 },
  pulse: { scaleAway: 1.06 },
};

// designer.md's ElementAnimationSchema.easing is a free-form optional string (not a strict enum —
// see animation.schema.ts), but the UI only ever offers these four, matching the vocabulary
// packages/types' ThemeAnimationEasingSchema already uses for the Theme editor's own easing
// dropdown, so all three surfaces (Theme editor, Designer, Player) feel consistent. Hand-rolled
// rather than borrowed from a library: fabric v7 doesn't re-export its named easing functions
// from its public package barrel, and the Player has no animation library dependency to borrow
// from either. Signature matches fabric's TEasingFunction: (timeElapsed, start, byValue, duration)
// — the Player's WAAPI usage converts these to keyframe lists rather than calling them per-frame.
export type EasingName = 'linear' | 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out';
export type EasingFn = (t: number, b: number, c: number, d: number) => number;

const easeInOutQuad: EasingFn = (t, b, c, d) => {
  const x = t / d;
  return b + c * (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
};

export const EASING_FUNCTIONS: Record<EasingName, EasingFn> = {
  linear: (t, b, c, d) => b + (c * t) / d,
  // CSS 'ease' has no exact quadratic equivalent — close enough for a canvas preview to share the
  // symmetric in-out curve rather than add a second near-identical formula.
  ease: easeInOutQuad,
  'ease-in': (t, b, c, d) => b + c * (t / d) * (t / d),
  'ease-out': (t, b, c, d) => {
    const x = t / d;
    return b + c * (1 - (1 - x) * (1 - x));
  },
  'ease-in-out': easeInOutQuad,
};

// Falls back to 'ease-out' on an unset/unrecognized name — matches Theme's own default for entrance.
export function resolveEasing(name?: string): EasingFn {
  return EASING_FUNCTIONS[name as EasingName] ?? EASING_FUNCTIONS['ease-out'];
}
