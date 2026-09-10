// designer_modernization_plan.md M5 — Fabric measures a Textbox's glyph metrics (width/wrapped
// height) against whatever font is *currently* loaded, including a fallback if the real
// @fontsource webfont hasn't finished loading yet. Nothing previously waited for it, so a
// freshly-created or font-family-changed text object's Fabric hit-box (used for selection bounds
// and corner-scale math) could be measured against the wrong font and never get re-measured. This
// is bounded/best-effort by design: never throws, never hangs past `timeoutMs` — a slow/broken
// font must not block canvas rendering.
export function waitForFont(cssFontFamily: string, timeoutMs = 2000): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return Promise.resolve();
  const probe = document.fonts.load(`400 16px ${cssFontFamily}`).catch(() => {});
  const ready = document.fonts.ready.catch(() => {});
  return Promise.race([
    Promise.all([probe, ready]).then(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}
