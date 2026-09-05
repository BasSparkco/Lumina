import { DestinationResolverService } from './destination-resolver.service';
import { WayfindingAiProviderError, type WayfindingAiProvider, type WayfindingAiProviderResult } from './providers/wayfinding-ai-provider';
import type { WayfindingAiDestination } from '@lumina/types';

function poi(overrides: Partial<WayfindingAiDestination> = {}): WayfindingAiDestination {
  return {
    id: 'poi_1',
    name: 'Starbucks',
    nameAr: null,
    aliases: [],
    category: 'Cafe',
    floorLabel: 'Ground',
    status: 'OPEN',
    description: null,
    descriptionAr: null,
    ...overrides,
  };
}

// docs/modules/ai_wayfinding_module_plan.md §13.1 — mocks the provider interface only; these
// tests must never spend external API credits.
function makeService(provider: Partial<WayfindingAiProvider> = {}) {
  const fakeProvider: WayfindingAiProvider = {
    resolveDestination: jest.fn(),
    ...provider,
  };
  return { service: new DestinationResolverService(fakeProvider), provider: fakeProvider };
}

function providerResult(overrides: Partial<WayfindingAiProviderResult['resolution']> & { type: string }): WayfindingAiProviderResult {
  return {
    resolution: overrides as WayfindingAiProviderResult['resolution'],
    inputTokens: 10,
    outputTokens: 5,
  };
}

describe('DestinationResolverService.normalize', () => {
  it('trims, collapses whitespace, and case-folds', () => {
    const { service } = makeService();
    expect(service.normalize('  Food   Court  ')).toBe('food court');
  });
});

describe('DestinationResolverService.findExactMatch', () => {
  it('matches by exact name without calling the provider', () => {
    const { service } = makeService();
    const destinations = [poi({ name: 'Starbucks' }), poi({ id: 'poi_2', name: 'Costa Coffee' })];
    expect(service.findExactMatch(destinations, 'starbucks')?.id).toBe('poi_1');
  });

  it('matches by alias', () => {
    const { service } = makeService();
    const destinations = [poi({ aliases: [{ value: 'the food court entrance', language: 'en' }] })];
    expect(service.findExactMatch(destinations, 'The Food Court Entrance')?.id).toBe('poi_1');
  });

  it('matches Arabic name after normalization', () => {
    const { service } = makeService();
    const destinations = [poi({ nameAr: 'مطعم' })];
    expect(service.findExactMatch(destinations, 'مطعم')?.id).toBe('poi_1');
  });

  it('returns null when more than one destination matches exactly (still ambiguous)', () => {
    const { service } = makeService();
    const destinations = [poi({ name: 'Cafe' }), poi({ id: 'poi_2', name: 'Cafe' })];
    expect(service.findExactMatch(destinations, 'cafe')).toBeNull();
  });

  it('returns null for an empty query', () => {
    const { service } = makeService();
    expect(service.findExactMatch([poi()], '   ')).toBeNull();
  });
});

describe('DestinationResolverService.resolve — deterministic pass', () => {
  it('resolves an exact match without calling the provider', async () => {
    const { service, provider } = makeService();
    const destinations = [poi()];

    const result = await service.resolve({ message: 'Starbucks', language: 'en', recentTurns: [], destinations });

    expect(provider.resolveDestination).not.toHaveBeenCalled();
    expect(result.outcome).toBe('EXACT_MATCH');
    expect(result.usedModel).toBe(false);
    expect(result.resolution).toEqual({ type: 'DESTINATION', poiId: 'poi_1', message: 'Starbucks' });
  });

  it('a CLOSED exact match is explained, not routed, and recorded as CLOSED_DESTINATION', async () => {
    const { service } = makeService();
    const destinations = [poi({ status: 'CLOSED' })];

    const result = await service.resolve({ message: 'Starbucks', language: 'en', recentTurns: [], destinations });

    expect(result.outcome).toBe('CLOSED_DESTINATION');
    expect(result.resolution.type).toBe('NO_MATCH');
    expect(result.resolvedPoiId).toBe('poi_1');
  });
});

describe('DestinationResolverService.resolve — provider validation (§7.4)', () => {
  it('accepts a DESTINATION whose poiId is in the catalog', async () => {
    const destinations = [poi({ id: 'poi_9', name: 'Food Court' })];
    const { service } = makeService({
      resolveDestination: jest.fn().mockResolvedValue(providerResult({ type: 'DESTINATION', poiId: 'poi_9', message: 'Here it is' })),
    });

    const result = await service.resolve({ message: 'where can I eat', language: 'en', recentTurns: [], destinations });

    expect(result.outcome).toBe('MODEL_DESTINATION');
    expect(result.resolution).toEqual({ type: 'DESTINATION', poiId: 'poi_9', message: 'Here it is' });
  });

  it('never accepts a model-generated POI id absent from the supplied catalog', async () => {
    const destinations = [poi({ id: 'poi_9' })];
    const { service } = makeService({
      resolveDestination: jest.fn().mockResolvedValue(providerResult({ type: 'DESTINATION', poiId: 'fabricated_id', message: 'Here' })),
    });

    const result = await service.resolve({ message: 'x', language: 'en', recentTurns: [], destinations });

    expect(result.outcome).toBe('INVALID_PROVIDER_OUTPUT');
    expect(result.resolution.type).toBe('NO_MATCH');
  });

  it('rejects a NEAREST_DESTINATION response containing even one unknown candidate id', async () => {
    const destinations = [poi({ id: 'poi_a' }), poi({ id: 'poi_b' })];
    const { service } = makeService({
      resolveDestination: jest.fn().mockResolvedValue(
        providerResult({ type: 'NEAREST_DESTINATION', candidatePoiIds: ['poi_a', 'poi_b', 'fabricated'], message: 'Nearest' }),
      ),
    });

    const result = await service.resolve({ message: 'nearest restroom', language: 'en', recentTurns: [], destinations });

    expect(result.outcome).toBe('INVALID_PROVIDER_OUTPUT');
  });

  it('accepts a fully valid NEAREST_DESTINATION and leaves candidate selection to the player (resolvedPoiId null)', async () => {
    const destinations = [poi({ id: 'poi_a' }), poi({ id: 'poi_b' })];
    const { service } = makeService({
      resolveDestination: jest.fn().mockResolvedValue(
        providerResult({ type: 'NEAREST_DESTINATION', candidatePoiIds: ['poi_a', 'poi_b'], message: 'Nearest' }),
      ),
    });

    const result = await service.resolve({ message: 'nearest restroom', language: 'en', recentTurns: [], destinations });

    expect(result.outcome).toBe('MODEL_DESTINATION');
    expect(result.resolvedPoiId).toBeNull();
    expect(result.resolution).toEqual({ type: 'NEAREST_DESTINATION', candidatePoiIds: ['poi_a', 'poi_b'], message: 'Nearest' });
  });

  it('rejects a CLARIFICATION response with an unknown alternative id', async () => {
    const destinations = [poi({ id: 'poi_a', name: 'A' })];
    const { service } = makeService({
      resolveDestination: jest.fn().mockResolvedValue(
        providerResult({ type: 'CLARIFICATION', alternativePoiIds: ['poi_a', 'fabricated'], message: 'Which one?' }),
      ),
    });

    const result = await service.resolve({ message: 'x', language: 'en', recentTurns: [], destinations });

    expect(result.outcome).toBe('INVALID_PROVIDER_OUTPUT');
  });

  it('builds clarification alternatives with label/floorLabel from the server catalog, not the provider', async () => {
    const destinations = [poi({ id: 'poi_a', name: 'Shop A', floorLabel: 'L1' }), poi({ id: 'poi_b', name: 'Shop B', floorLabel: 'L2' })];
    const { service } = makeService({
      resolveDestination: jest.fn().mockResolvedValue(
        providerResult({ type: 'CLARIFICATION', alternativePoiIds: ['poi_a', 'poi_b'], message: 'Which one?' }),
      ),
    });

    const result = await service.resolve({ message: 'shop', language: 'en', recentTurns: [], destinations });

    expect(result.resolution).toEqual({
      type: 'CLARIFICATION',
      message: 'Which one?',
      alternatives: [
        { poiId: 'poi_a', label: 'Shop A', floorLabel: 'L1' },
        { poiId: 'poi_b', label: 'Shop B', floorLabel: 'L2' },
      ],
    });
  });

  it('passes through a NO_MATCH response as-is', async () => {
    const { service } = makeService({
      resolveDestination: jest.fn().mockResolvedValue(providerResult({ type: 'NO_MATCH', message: 'Nothing found' })),
    });

    const result = await service.resolve({ message: 'x', language: 'en', recentTurns: [], destinations: [poi()] });

    expect(result.outcome).toBe('NO_MATCH');
    expect(result.resolution).toEqual({ type: 'NO_MATCH', message: 'Nothing found' });
  });
});

describe('DestinationResolverService.resolve — provider failure handling', () => {
  it('maps a provider timeout to UNAVAILABLE/PROVIDER_TIMEOUT without throwing', async () => {
    const { service } = makeService({
      resolveDestination: jest.fn().mockRejectedValue(new WayfindingAiProviderError('TIMEOUT', 'timed out')),
    });

    const result = await service.resolve({ message: 'x', language: 'en', recentTurns: [], destinations: [poi()] });

    expect(result.outcome).toBe('PROVIDER_TIMEOUT');
    expect(result.resolution.type).toBe('UNAVAILABLE');
  });

  it('maps a generic provider error to UNAVAILABLE/PROVIDER_ERROR', async () => {
    const { service } = makeService({
      resolveDestination: jest.fn().mockRejectedValue(new WayfindingAiProviderError('UNAVAILABLE', 'down')),
    });

    const result = await service.resolve({ message: 'x', language: 'en', recentTurns: [], destinations: [poi()] });

    expect(result.outcome).toBe('PROVIDER_ERROR');
  });

  it('maps invalid provider output to INVALID_PROVIDER_OUTPUT', async () => {
    const { service } = makeService({
      resolveDestination: jest.fn().mockRejectedValue(new WayfindingAiProviderError('INVALID_OUTPUT', 'bad json')),
    });

    const result = await service.resolve({ message: 'x', language: 'en', recentTurns: [], destinations: [poi()] });

    expect(result.outcome).toBe('INVALID_PROVIDER_OUTPUT');
  });

  it('rethrows an error that is not a WayfindingAiProviderError rather than silently swallowing it', async () => {
    const { service } = makeService({
      resolveDestination: jest.fn().mockRejectedValue(new Error('unexpected')),
    });

    await expect(
      service.resolve({ message: 'x', language: 'en', recentTurns: [], destinations: [poi()] }),
    ).rejects.toThrow('unexpected');
  });
});
