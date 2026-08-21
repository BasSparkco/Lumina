// Kiosk analytics (7.4) — popular searches/destinations, session counts. Fire-and-forget POSTs
// to the batched ingest endpoint; kiosk interactions (a search keystroke settling, a POI tap) are
// low-frequency enough that a single-event POST per occurrence is simpler than building a
// buffering/flush pipeline like proof-of-play's, and a lost event on a flaky connection isn't
// worth retry complexity for a "popular searches" chart.
import { api } from './api';

export type KioskEventType = 'SESSION_START' | 'SEARCH' | 'POI_VIEW';

export function logKioskEvent(type: KioskEventType, extra?: { query?: string; poiId?: string; poiName?: string }) {
  api.logWayfindingEvents([{ type, ...extra }]).catch(() => {
    /* best-effort — analytics gaps aren't worth surfacing to the kiosk UI */
  });
}
