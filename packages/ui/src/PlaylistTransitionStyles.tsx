import { PLAYLIST_TRANSITION_KEYFRAMES_CSS } from '@lumina/types';

// The `@keyframes` every playlist item transition (fade/crossfade/slide/zoom/flip) references —
// rendered once per player instance, not once per item. Mirrors ElementAnimationStyles' pattern
// for theme element entrance/exit animation.
export function PlaylistTransitionStyles() {
  return <style>{PLAYLIST_TRANSITION_KEYFRAMES_CSS}</style>;
}
