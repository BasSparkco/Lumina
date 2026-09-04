import { z } from 'zod';

/**
 * Every transition identifier the player's registry recognizes today. This is the single
 * source of truth for the dashboard's per-item/per-playlist dropdowns and the player's
 * rendering registry — add a new effect by adding one entry to PLAYLIST_TRANSITION_REGISTRY
 * below (plus, if it should be persisted, a matching Prisma enum value); nothing else in the
 * player's render loop needs to change (see resolvePlaylistTransition's fallback).
 */
export const PLAYLIST_TRANSITION_IDS = [
  'NONE',
  'FADE',
  'CROSSFADE',
  'SLIDE_LEFT',
  'SLIDE_RIGHT',
  'ZOOM',
  'FLIP',
] as const;

export const PlaylistTransitionIdSchema = z.enum(PLAYLIST_TRANSITION_IDS);
export type PlaylistTransitionId = z.infer<typeof PlaylistTransitionIdSchema>;

export const DEFAULT_PLAYLIST_TRANSITION_ID: PlaylistTransitionId = 'NONE';
export const DEFAULT_PLAYLIST_TRANSITION_DURATION_MS = 500;

// The item-level dropdown's "inherit the playlist" option. Distinct from a real transition id
// so `resolveEffectiveTransitionId` can tell "explicitly no item override" apart from "item
// explicitly wants a NONE/cut transition" — same distinction cropZoom's null already makes.
export const INHERIT_PLAYLIST_TRANSITION = 'DEFAULT' as const;

export interface PlaylistTransitionDefinition {
  id: PlaylistTransitionId;
  label: string;
  // false only for NONE — a plain hard cut, no dual-layer render, no animation at all.
  overlap: boolean;
  // true: outgoing and incoming both animate across the full duration (a classic dissolve).
  // false: outgoing animates out over the first half, incoming animates in over the second —
  // a fade-through-black rather than a cross-dissolve. Only meaningful when overlap is true.
  simultaneous: boolean;
  outgoingKeyframes?: string;
  incomingKeyframes?: string;
  easing: string;
}

/**
 * The `@keyframes` every transition below animates through — one app-wide `<style>` block
 * (see PlaylistTransitionStyles in @lumina/ui), not generated per item. Mirrors the pattern
 * ELEMENT_ANIMATION_KEYFRAMES_CSS uses for theme element entrance/exit animation.
 */
export const PLAYLIST_TRANSITION_KEYFRAMES_CSS = `
@keyframes lumina-pl-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes lumina-pl-fade-out { from { opacity: 1; } to { opacity: 0; } }
@keyframes lumina-pl-slide-in-left { from { opacity: 0; transform: translateX(100%); } to { opacity: 1; transform: translateX(0); } }
@keyframes lumina-pl-slide-out-left { from { opacity: 1; transform: translateX(0); } to { opacity: 0; transform: translateX(-100%); } }
@keyframes lumina-pl-slide-in-right { from { opacity: 0; transform: translateX(-100%); } to { opacity: 1; transform: translateX(0); } }
@keyframes lumina-pl-slide-out-right { from { opacity: 1; transform: translateX(0); } to { opacity: 0; transform: translateX(100%); } }
@keyframes lumina-pl-zoom-in { from { opacity: 0; transform: scale(1.15); } to { opacity: 1; transform: scale(1); } }
@keyframes lumina-pl-zoom-out { from { opacity: 1; transform: scale(1); } to { opacity: 0; transform: scale(0.85); } }
@keyframes lumina-pl-flip-in { from { opacity: 0; transform: perspective(1200px) rotateY(90deg); } to { opacity: 1; transform: perspective(1200px) rotateY(0deg); } }
@keyframes lumina-pl-flip-out { from { opacity: 1; transform: perspective(1200px) rotateY(0deg); } to { opacity: 0; transform: perspective(1200px) rotateY(-90deg); } }
`;

export const PLAYLIST_TRANSITION_REGISTRY: Record<PlaylistTransitionId, PlaylistTransitionDefinition> = {
  NONE: { id: 'NONE', label: 'Cut (No Transition)', overlap: false, simultaneous: true, easing: 'linear' },
  FADE: {
    id: 'FADE', label: 'Fade', overlap: true, simultaneous: false, easing: 'ease-in-out',
    outgoingKeyframes: 'lumina-pl-fade-out', incomingKeyframes: 'lumina-pl-fade-in',
  },
  CROSSFADE: {
    id: 'CROSSFADE', label: 'Crossfade', overlap: true, simultaneous: true, easing: 'ease-in-out',
    outgoingKeyframes: 'lumina-pl-fade-out', incomingKeyframes: 'lumina-pl-fade-in',
  },
  SLIDE_LEFT: {
    id: 'SLIDE_LEFT', label: 'Slide Left', overlap: true, simultaneous: true, easing: 'ease-in-out',
    outgoingKeyframes: 'lumina-pl-slide-out-left', incomingKeyframes: 'lumina-pl-slide-in-left',
  },
  SLIDE_RIGHT: {
    id: 'SLIDE_RIGHT', label: 'Slide Right', overlap: true, simultaneous: true, easing: 'ease-in-out',
    outgoingKeyframes: 'lumina-pl-slide-out-right', incomingKeyframes: 'lumina-pl-slide-in-right',
  },
  ZOOM: {
    id: 'ZOOM', label: 'Zoom', overlap: true, simultaneous: true, easing: 'ease-in-out',
    outgoingKeyframes: 'lumina-pl-zoom-out', incomingKeyframes: 'lumina-pl-zoom-in',
  },
  FLIP: {
    id: 'FLIP', label: 'Flip', overlap: true, simultaneous: true, easing: 'ease-in-out',
    outgoingKeyframes: 'lumina-pl-flip-out', incomingKeyframes: 'lumina-pl-flip-in',
  },
};

export const PLAYLIST_TRANSITION_OPTIONS: PlaylistTransitionDefinition[] = PLAYLIST_TRANSITION_IDS.map(
  id => PLAYLIST_TRANSITION_REGISTRY[id],
);

/**
 * The registry lookup every renderer must go through instead of switching on the identifier
 * itself. An identifier the player doesn't recognize — a transition added to the DB enum/dash-
 * board after this build, a typo, a future player version's id reaching an older one — resolves
 * to NONE (a plain cut) instead of throwing or rendering nothing. This is what lets new
 * transitions ship without a player code change: the registry can grow (new entries), but a
 * player build that predates an entry degrades safely rather than breaking.
 */
export function resolvePlaylistTransition(id: string | null | undefined): PlaylistTransitionDefinition {
  if (!id) return PLAYLIST_TRANSITION_REGISTRY[DEFAULT_PLAYLIST_TRANSITION_ID];
  return PLAYLIST_TRANSITION_REGISTRY[id as PlaylistTransitionId] ?? PLAYLIST_TRANSITION_REGISTRY[DEFAULT_PLAYLIST_TRANSITION_ID];
}

/** item.transition wins unless it's unset/'DEFAULT', in which case the playlist's default applies. */
export function resolveEffectiveTransitionId(
  itemTransition: string | null | undefined,
  playlistDefaultTransition: string | null | undefined,
): string {
  if (itemTransition && itemTransition !== INHERIT_PLAYLIST_TRANSITION) return itemTransition;
  return playlistDefaultTransition ?? DEFAULT_PLAYLIST_TRANSITION_ID;
}

export function resolveEffectiveTransition(
  itemTransition: string | null | undefined,
  playlistDefaultTransition: string | null | undefined,
): PlaylistTransitionDefinition {
  return resolvePlaylistTransition(resolveEffectiveTransitionId(itemTransition, playlistDefaultTransition));
}

/** CSS `animation-*` values for the incoming (entering) layer — undefined for NONE/unrecognized. */
export function buildIncomingTransitionStyle(def: PlaylistTransitionDefinition, durationMs: number): Record<string, string> | undefined {
  if (!def.overlap || !def.incomingKeyframes) return undefined;
  const duration = def.simultaneous ? durationMs : durationMs / 2;
  const delay = def.simultaneous ? 0 : durationMs / 2;
  return {
    animationName: def.incomingKeyframes,
    animationDuration: `${duration}ms`,
    animationDelay: `${delay}ms`,
    animationTimingFunction: def.easing,
    animationFillMode: 'both',
  };
}

/** CSS `animation-*` values for the outgoing (leaving) layer — undefined for NONE/unrecognized. */
export function buildOutgoingTransitionStyle(def: PlaylistTransitionDefinition, durationMs: number): Record<string, string> | undefined {
  if (!def.overlap || !def.outgoingKeyframes) return undefined;
  const duration = def.simultaneous ? durationMs : durationMs / 2;
  return {
    animationName: def.outgoingKeyframes,
    animationDuration: `${duration}ms`,
    animationDelay: '0ms',
    animationTimingFunction: def.easing,
    animationFillMode: 'both',
  };
}
