// Text-to-speech route readout (7.4) — plain browser SpeechSynthesis, no new dependency. Kiosk
// hardware is browser-based (same assumption the on-screen keyboard in WayfindingDirectoryPanel
// already makes), so the Web Speech API is a safe baseline; a browser without it just won't offer
// the button (see `ttsSupported`).
import type { WayfindingLang } from './wayfindingLang';

export function ttsSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

// `onDone` fires once whether speech finished naturally, was cancelled, or errored — callers use
// it to keep a "currently speaking" UI toggle honest without polling window.speechSynthesis.
export function speakSteps(steps: string[], lang: WayfindingLang, onDone?: () => void) {
  if (!ttsSupported() || steps.length === 0) { onDone?.(); return; }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(steps.join('. '));
  utterance.lang = lang === 'ar' ? 'ar-SA' : 'en-US';
  if (onDone) {
    utterance.onend = onDone;
    utterance.onerror = onDone;
  }
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking() {
  if (ttsSupported()) window.speechSynthesis.cancel();
}
