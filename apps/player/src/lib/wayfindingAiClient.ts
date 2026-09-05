import type { WayfindingAiResolution } from '@lumina/types';
import { api, ApiError } from './api';
import type { ConversationTurn } from './wayfindingAiSession';

// docs/modules/ai_wayfinding_module_plan.md §9.3/§9.4 — owns the one in-flight request per
// session (a second call while one is pending aborts the first rather than racing two) and
// exposes a single `abort()` so the assistant component can cancel on close/timeout/screen
// reload/session reset without threading an AbortController through every call site.
export class WayfindingAiClient {
  private controller: AbortController | null = null;

  async resolve(message: string, language: 'en' | 'ar', recentTurns: ConversationTurn[]): Promise<WayfindingAiResolution> {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    try {
      return await api.resolveWayfindingAi({ message, language, recentTurns }, controller.signal);
    } catch (err) {
      // Never claim an AI answer was generated offline (§3.5) — any failure (network, timeout,
      // 403 from a lease/entitlement/config check, provider outage surfaced as a generic error)
      // becomes the same neutral UNAVAILABLE shape the API itself would return for a genuine
      // provider outage, so the assistant UI has exactly one failure path to render.
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      const message = err instanceof ApiError ? err.message : 'unavailable';
      return { type: 'UNAVAILABLE', message };
    } finally {
      if (this.controller === controller) this.controller = null;
    }
  }

  abort(): void {
    this.controller?.abort();
    this.controller = null;
  }
}
