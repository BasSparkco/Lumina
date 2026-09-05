import { Inject, Injectable } from '@nestjs/common';
import type {
  ProviderResolution,
  WayfindingAiDestination,
  WayfindingAiLanguage,
  WayfindingAiResolution,
  WayfindingAiUsageOutcome,
} from '@lumina/types';
import { WAYFINDING_AI_PROVIDER, WayfindingAiProviderError, type WayfindingAiProvider } from './providers/wayfinding-ai-provider';

export interface DestinationResolutionOutcome {
  resolution: WayfindingAiResolution;
  outcome: WayfindingAiUsageOutcome;
  usedModel: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  resolvedPoiId: string | null;
}

const LOCALIZED = {
  en: {
    closed: (name: string) => `${name} is currently closed.`,
    unavailable: 'The assistant is unavailable right now. Please use the Directory instead.',
    noMatch: "I couldn't find that in this building's directory. Try the Directory instead.",
  },
  ar: {
    closed: (name: string) => `${name} مغلق حاليًا.`,
    unavailable: 'المساعد غير متاح حاليًا. يرجى استخدام الدليل بدلاً من ذلك.',
    noMatch: 'لم أتمكن من العثور على ذلك في دليل هذا المبنى. جرّب الدليل بدلاً من ذلك.',
  },
} satisfies Record<WayfindingAiLanguage, { closed: (name: string) => string; unavailable: string; noMatch: string }>;

// docs/modules/ai_wayfinding_module_plan.md §4.1/§7.4 — the deterministic-first, provider-second
// resolution pipeline. This is the ONLY place a provider's output is trusted enough to become a
// WayfindingAiResolution: every POI id the provider returns is re-checked against the exact same
// server-loaded, building-scoped catalog the provider itself was given, and any single invalid id
// invalidates the whole response (fail closed) rather than silently dropping just that one.
@Injectable()
export class DestinationResolverService {
  constructor(@Inject(WAYFINDING_AI_PROVIDER) private readonly provider: WayfindingAiProvider) {}

  // Server-owned normalization (§6.2): trim, Unicode-normalize (NFKC collapses compatibility/
  // combining-form differences that would otherwise make an identical-looking string compare
  // unequal), collapse internal whitespace, then case-fold. `toLocaleLowerCase()` is a no-op for
  // Arabic (no case) and correct for English/Latin aliases.
  normalize(value: string): string {
    return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  }

  // Exactly one destination whose name, nameAr, or any alias normalizes to the same string as the
  // query. More than one match is deliberately NOT treated as exact — an ambiguous "exact" match
  // still needs a clarification, so it falls through to the provider like any other query.
  findExactMatch(destinations: WayfindingAiDestination[], query: string): WayfindingAiDestination | null {
    const normalizedQuery = this.normalize(query);
    if (!normalizedQuery) return null;
    const matches = destinations.filter((d) => {
      if (this.normalize(d.name) === normalizedQuery) return true;
      if (d.nameAr && this.normalize(d.nameAr) === normalizedQuery) return true;
      return d.aliases.some((a) => this.normalize(a.value) === normalizedQuery);
    });
    return matches.length === 1 ? matches[0]! : null;
  }

  async resolve(input: {
    message: string;
    language: WayfindingAiLanguage;
    recentTurns: { role: 'user' | 'assistant'; text: string }[];
    destinations: WayfindingAiDestination[];
  }): Promise<DestinationResolutionOutcome> {
    const exact = this.findExactMatch(input.destinations, input.message);
    if (exact) return this.destinationOutcome(exact, 'EXACT_MATCH', false, null, null, input.language);

    let result;
    try {
      result = await this.provider.resolveDestination({
        message: input.message,
        language: input.language,
        recentTurns: input.recentTurns,
        destinations: input.destinations,
      });
    } catch (err) {
      if (err instanceof WayfindingAiProviderError) {
        const outcome: WayfindingAiUsageOutcome =
          err.code === 'TIMEOUT' ? 'PROVIDER_TIMEOUT'
          : err.code === 'INVALID_OUTPUT' ? 'INVALID_PROVIDER_OUTPUT'
          : 'PROVIDER_ERROR';
        return this.unavailableOutcome(outcome, true, input.language);
      }
      throw err;
    }

    return this.validateAndBuild(result, input.destinations, input.language);
  }

  private validateAndBuild(
    result: { resolution: ProviderResolution; inputTokens: number | null; outputTokens: number | null },
    destinations: WayfindingAiDestination[],
    language: WayfindingAiLanguage,
  ): DestinationResolutionOutcome {
    const byId = new Map(destinations.map((d) => [d.id, d]));
    const { resolution } = result;

    if (resolution.type === 'DESTINATION') {
      const poi = byId.get(resolution.poiId);
      if (!poi) return this.invalidOutputOutcome(result.inputTokens, result.outputTokens, language);
      return this.destinationOutcome(poi, 'MODEL_DESTINATION', true, result.inputTokens, result.outputTokens, language, resolution.message);
    }

    if (resolution.type === 'NEAREST_DESTINATION') {
      const valid = resolution.candidatePoiIds.every((id) => byId.has(id));
      if (!valid || resolution.candidatePoiIds.length === 0) {
        return this.invalidOutputOutcome(result.inputTokens, result.outputTokens, language);
      }
      return {
        resolution: { type: 'NEAREST_DESTINATION', candidatePoiIds: resolution.candidatePoiIds, message: resolution.message },
        outcome: 'MODEL_DESTINATION',
        usedModel: true,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        resolvedPoiId: null, // the player, not the API, picks the winning candidate by route cost
      };
    }

    if (resolution.type === 'CLARIFICATION') {
      const alternatives = resolution.alternativePoiIds
        .map((id) => byId.get(id))
        .filter((poi): poi is WayfindingAiDestination => !!poi);
      if (alternatives.length !== resolution.alternativePoiIds.length || alternatives.length === 0) {
        return this.invalidOutputOutcome(result.inputTokens, result.outputTokens, language);
      }
      return {
        resolution: {
          type: 'CLARIFICATION',
          message: resolution.message,
          alternatives: alternatives.map((poi) => ({ poiId: poi.id, label: poi.name, floorLabel: poi.floorLabel })),
        },
        outcome: 'CLARIFICATION',
        usedModel: true,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        resolvedPoiId: null,
      };
    }

    // NO_MATCH
    return {
      resolution: { type: 'NO_MATCH', message: resolution.message || LOCALIZED[language].noMatch },
      outcome: 'NO_MATCH',
      usedModel: true,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      resolvedPoiId: null,
    };
  }

  // §7.4: prefer OPEN; a CLOSED best match must not silently open a route — explain it's closed
  // instead. RELOCATED POIs route normally: this schema has no separate old/new-location field,
  // so a RELOCATED row's own pin is by definition already the current location.
  private destinationOutcome(
    poi: WayfindingAiDestination,
    outcome: WayfindingAiUsageOutcome,
    usedModel: boolean,
    inputTokens: number | null,
    outputTokens: number | null,
    language: WayfindingAiLanguage,
    providerMessage?: string,
  ): DestinationResolutionOutcome {
    if (poi.status === 'CLOSED') {
      return {
        resolution: { type: 'NO_MATCH', message: LOCALIZED[language].closed(language === 'ar' && poi.nameAr ? poi.nameAr : poi.name) },
        outcome: 'CLOSED_DESTINATION',
        usedModel,
        inputTokens,
        outputTokens,
        resolvedPoiId: poi.id,
      };
    }
    return {
      resolution: { type: 'DESTINATION', poiId: poi.id, message: providerMessage ?? poi.name },
      outcome,
      usedModel,
      inputTokens,
      outputTokens,
      resolvedPoiId: poi.id,
    };
  }

  private invalidOutputOutcome(inputTokens: number | null, outputTokens: number | null, language: WayfindingAiLanguage): DestinationResolutionOutcome {
    return {
      resolution: { type: 'NO_MATCH', message: LOCALIZED[language].noMatch },
      outcome: 'INVALID_PROVIDER_OUTPUT',
      usedModel: true,
      inputTokens,
      outputTokens,
      resolvedPoiId: null,
    };
  }

  private unavailableOutcome(outcome: WayfindingAiUsageOutcome, usedModel: boolean, language: WayfindingAiLanguage): DestinationResolutionOutcome {
    return {
      resolution: { type: 'UNAVAILABLE', message: LOCALIZED[language].unavailable },
      outcome,
      usedModel,
      inputTokens: null,
      outputTokens: null,
      resolvedPoiId: null,
    };
  }
}
