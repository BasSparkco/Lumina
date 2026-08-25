// Browsers refuse unmuted autoplay until the page has seen a user gesture (a signage kiosk
// running unattended never gets one on its own, but a touch-capable kiosk or an installer
// tapping the screen once during setup does). Once any interaction happens anywhere on the
// page, Chrome/Firefox grant "sticky activation" for the rest of the document's lifetime, so a
// single tap is enough to unlock unmuted autoplay for every video mounted afterward too — this
// module just lets ZonePlayer/AppPlayer know the moment that happens so they can retry.
let unlocked = false;
const listeners = new Set<() => void>();

function unlock() {
  if (unlocked) return;
  unlocked = true;
  listeners.forEach(cb => cb());
}

if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', unlock, { once: true, capture: true });
  window.addEventListener('keydown', unlock, { once: true, capture: true });
}

export function isAudioUnlocked(): boolean {
  return unlocked;
}

// Returns an unsubscribe function. If audio is already unlocked, fires immediately (still
// async-safe to call from an effect).
export function onAudioUnlock(cb: () => void): () => void {
  if (unlocked) { cb(); return () => undefined; }
  listeners.add(cb);
  return () => listeners.delete(cb);
}
