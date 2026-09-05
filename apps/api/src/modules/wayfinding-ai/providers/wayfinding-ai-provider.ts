import type { ProviderResolution, WayfindingAiDestination, WayfindingAiLanguage } from '@lumina/types';

// docs/modules/ai_wayfinding_module_plan.md §3.6/§7.3 — application-owned provider interface.
// No controller, player code, or database model ever imports a concrete provider; they depend on
// this interface (and the WAYFINDING_AI_PROVIDER injection token) only, so swapping providers is
// an operational/environment change, never a domain or player-facing change.
export interface WayfindingAiProviderInput {
  message: string;
  language: WayfindingAiLanguage;
  recentTurns: { role: 'user' | 'assistant'; text: string }[];
  destinations: WayfindingAiDestination[];
}

export interface WayfindingAiProviderResult {
  resolution: ProviderResolution;
  // Token counts feed WayfindingAiUsageLog for cost measurement (§3.7/§11.3) — null when the
  // provider doesn't report them, never fabricated.
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface WayfindingAiProvider {
  resolveDestination(input: WayfindingAiProviderInput): Promise<WayfindingAiProviderResult>;
}

export const WAYFINDING_AI_PROVIDER = Symbol('WAYFINDING_AI_PROVIDER');

// Thrown by a provider implementation to signal a distinct, loggable failure mode
// (DestinationResolverService maps this to the matching WayfindingAiUsageOutcome) rather than a
// generic thrown Error, which would all collapse to the same PROVIDER_ERROR outcome.
export class WayfindingAiProviderError extends Error {
  constructor(public readonly code: 'TIMEOUT' | 'UNAVAILABLE' | 'INVALID_OUTPUT', message: string) {
    super(message);
  }
}

// Bound as WAYFINDING_AI_PROVIDER when AI_WAYFINDING_API_KEY isn't configured (a fresh
// deployment, local dev, or a deliberately AI-less environment) so the app still boots and the
// deterministic exact-name/alias pass in DestinationResolverService keeps working — only a
// request that genuinely needs the provider (no strong deterministic match) surfaces
// UNAVAILABLE, exactly as it would for a real provider outage.
export class NullWayfindingAiProvider implements WayfindingAiProvider {
  // Returns a rejected Promise rather than throwing synchronously — a caller that does
  // `await provider.resolveDestination()` inside a try/catch would still observe either form
  // the same way, but a plain `.catch()`/`.rejects` consumer (including this class's own unit
  // test) only ever sees a promise rejection, never a synchronous throw, from a method typed to
  // return Promise<T>.
  resolveDestination(): Promise<never> {
    return Promise.reject(new WayfindingAiProviderError('UNAVAILABLE', 'AI Wayfinding provider is not configured'));
  }
}
