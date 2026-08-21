const RELOAD_DELAY_MS = 5000;
let reloadScheduled = false;

// A crashed render tears down PlayerPage's heartbeat interval and disconnects its socket — the
// same channel the dashboard would otherwise use to push a remote reload command. There's no
// user on an unattended kiosk to hit refresh, so a full page reload is the only reliable way
// back to a working state; it re-establishes both from scratch instead of trying to resume from
// whatever state caused the crash. Guarded so a storm of errors only schedules one reload.
export function scheduleReload(context: string, error: unknown) {
  console.error(`[player] unhandled error (${context}), reloading in ${RELOAD_DELAY_MS}ms`, error);
  if (reloadScheduled) return;
  reloadScheduled = true;
  window.setTimeout(() => window.location.reload(), RELOAD_DELAY_MS);
}

// Covers the failure modes a React error boundary can't: errors thrown outside render (event
// handlers, timers) and rejected promises with no .catch — both otherwise fail silently on a
// screen nobody's watching.
export function installGlobalCrashWatchdog() {
  window.addEventListener('error', e => scheduleReload('window error', e.error ?? e.message));
  window.addEventListener('unhandledrejection', e => scheduleReload('unhandled rejection', e.reason));
}
