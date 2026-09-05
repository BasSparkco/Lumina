import { NullWayfindingAiProvider, WayfindingAiProviderError } from './wayfinding-ai-provider';
import { OpenAiWayfindingAiProvider } from './openai-wayfinding-ai.provider';

// docs/modules/ai_wayfinding_module_plan.md §13.1 — unit tests must never spend external API
// credits. NullWayfindingAiProvider needs no mocking at all (it never calls a network); the
// OpenAI adapter tests replace its internal client with a fake before ever invoking it.
describe('NullWayfindingAiProvider', () => {
  it('rejects with a generic UNAVAILABLE error and never attempts a network call', async () => {
    const provider = new NullWayfindingAiProvider();
    await expect(provider.resolveDestination()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });
});

interface FakeClient {
  responses: { create: jest.Mock };
}

function withFakeClient(provider: OpenAiWayfindingAiProvider, response: unknown): FakeClient {
  const fakeClient: FakeClient = { responses: { create: jest.fn().mockResolvedValue(response) } };
  (provider as unknown as { client: FakeClient }).client = fakeClient;
  return fakeClient;
}

const baseInput = {
  message: 'where is the food court',
  language: 'en' as const,
  recentTurns: [],
  destinations: [{
    id: 'poi_1', name: 'Food Court', nameAr: null, aliases: [], category: 'Dining',
    floorLabel: 'L1', status: 'OPEN' as const, description: null, descriptionAr: null,
  }],
};

describe('OpenAiWayfindingAiProvider.resolveDestination', () => {
  it('parses a valid DESTINATION structured response and reports token usage', async () => {
    const provider = new OpenAiWayfindingAiProvider('fake-key', 'gpt-4.1-mini', 8000);
    withFakeClient(provider, {
      output_text: JSON.stringify({ type: 'DESTINATION', message: 'Here', poiId: 'poi_1', candidatePoiIds: null, alternativePoiIds: null }),
      usage: { input_tokens: 42, output_tokens: 8 },
    });

    const result = await provider.resolveDestination(baseInput);

    expect(result.resolution).toEqual({ type: 'DESTINATION', poiId: 'poi_1', message: 'Here' });
    expect(result.inputTokens).toBe(42);
    expect(result.outputTokens).toBe(8);
  });

  it('throws INVALID_OUTPUT when the model output is not valid JSON', async () => {
    const provider = new OpenAiWayfindingAiProvider('fake-key', 'gpt-4.1-mini', 8000);
    withFakeClient(provider, { output_text: 'not json', usage: null });

    await expect(provider.resolveDestination(baseInput)).rejects.toMatchObject({ code: 'INVALID_OUTPUT' });
  });

  it('throws INVALID_OUTPUT when the parsed JSON fails schema validation (unknown type)', async () => {
    const provider = new OpenAiWayfindingAiProvider('fake-key', 'gpt-4.1-mini', 8000);
    withFakeClient(provider, { output_text: JSON.stringify({ type: 'MADE_UP' }), usage: null });

    await expect(provider.resolveDestination(baseInput)).rejects.toMatchObject({ code: 'INVALID_OUTPUT' });
  });

  it('maps a client-thrown timeout error to a WayfindingAiProviderError with code TIMEOUT', async () => {
    const provider = new OpenAiWayfindingAiProvider('fake-key', 'gpt-4.1-mini', 8000);
    const fakeClient: FakeClient = { responses: { create: jest.fn().mockRejectedValue(new Error('Request timed out.')) } };
    (provider as unknown as { client: FakeClient }).client = fakeClient;

    await expect(provider.resolveDestination(baseInput)).rejects.toBeInstanceOf(WayfindingAiProviderError);
    await expect(provider.resolveDestination(baseInput)).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('maps any other client-thrown error to UNAVAILABLE', async () => {
    const provider = new OpenAiWayfindingAiProvider('fake-key', 'gpt-4.1-mini', 8000);
    const fakeClient: FakeClient = { responses: { create: jest.fn().mockRejectedValue(new Error('502 Bad Gateway')) } };
    (provider as unknown as { client: FakeClient }).client = fakeClient;

    await expect(provider.resolveDestination(baseInput)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });
});
