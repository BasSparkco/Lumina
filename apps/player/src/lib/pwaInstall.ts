// Chrome grants navigator.storage.persist() based on the origin's "site engagement" — installed
// PWAs are one of the strongest positive signals, an ordinary browser tab with no interaction
// history is the weakest. Capturing the install prompt and firing it opportunistically improves
// the odds for an attended/touch-capable kiosk (an installer taps once during setup). It cannot
// help a genuinely unattended, no-touch kiosk that never gets a user gesture at all — Chrome
// requires one to show the prompt — that case has no client-side fix; see audioUnlock.ts's own
// comment about the same constraint, and update_payer.md's Phase 3 status for the operational
// alternative (launch Chrome in --app= mode, or install the PWA once during provisioning).
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
  });
}

// Safe to call with no prompt captured (nothing happens) or after it's already been used (Chrome
// only lets a given prompt instance fire once).
export async function tryInstallPwa(): Promise<void> {
  if (!deferredPrompt) return;
  const prompt = deferredPrompt;
  deferredPrompt = null;
  await prompt.prompt().catch(() => undefined);
}
