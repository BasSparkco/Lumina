import { ELEMENT_ANIMATION_KEYFRAMES_CSS } from '@lumina/types';

// The `@keyframes` every per-element entrance/exit/emphasis animation references — rendered once
// per canvas/screen (not once per animated element), shared by the dashboard's ThemeCanvasPanel
// and the player's ThemeRenderer so both animate identically.
export function ElementAnimationStyles() {
  return <style>{ELEMENT_ANIMATION_KEYFRAMES_CSS}</style>;
}
