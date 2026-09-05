import { z } from 'zod';

// AI Wayfinding (docs/modules/ai_wayfinding_module_plan.md §5) — the shared player/API boundary
// contract. The AI provider never computes a route; it only resolves a visitor request to one or
// more verified POI ids, which the player's existing local Dijkstra (apps/player/src/lib/
// routing.ts) then routes to exactly as if the visitor had picked the POI from the Directory.

export const WAYFINDING_AI_LANGUAGES = ['en', 'ar'] as const;
export const WayfindingAiLanguageSchema = z.enum(WAYFINDING_AI_LANGUAGES);
export type WayfindingAiLanguage = z.infer<typeof WayfindingAiLanguageSchema>;

// Per-screen assistant configuration exposed to the player — never includes a provider name,
// model, prompt, or API key (those are environment configuration, §3.6). `enabled` mirrors
// WayfindingAiScreenConfig.enabled; the player never sees the row at all when the tenant doesn't
// own WAYFINDING_AI or when it isn't configured for this screen (see PlayerService.getState()).
export interface WayfindingAiPlayerConfig {
  enabled: boolean;
  welcomeMessage: string;
  welcomeMessageAr: string;
  maxTurns: number;
}

// Bounds on every player/API boundary field — enforced by the Zod schemas below, not just by
// convention, since visitor input is untrusted (§11.1).
export const WAYFINDING_AI_MAX_INPUT_CHARS = 500;
export const WAYFINDING_AI_MAX_RECENT_TURNS = 8;
export const WAYFINDING_AI_MAX_ALTERNATIVES = 5;
export const WAYFINDING_AI_MAX_CANDIDATES = 8;
export const WAYFINDING_AI_MAX_MESSAGE_CHARS = 300;

const ConversationTurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string().min(1).max(WAYFINDING_AI_MAX_INPUT_CHARS),
});

// Player -> API. The server derives screenId/organizationId/building/catalog from the
// authenticated screen token — none of that travels in this body (§7.2).
export const ResolveWayfindingAiRequestSchema = z.object({
  message: z.string().min(1).max(WAYFINDING_AI_MAX_INPUT_CHARS),
  language: WayfindingAiLanguageSchema,
  recentTurns: z.array(ConversationTurnSchema).max(WAYFINDING_AI_MAX_RECENT_TURNS).optional(),
});
export type ResolveWayfindingAiRequest = z.infer<typeof ResolveWayfindingAiRequestSchema>;

const ClarificationAlternativeSchema = z.object({
  poiId: z.string().min(1),
  label: z.string().min(1).max(WAYFINDING_AI_MAX_MESSAGE_CHARS),
  floorLabel: z.string().min(1).max(WAYFINDING_AI_MAX_MESSAGE_CHARS),
});

// API -> player. A discriminated union so the player can render each outcome deliberately rather
// than treating every response as "here is a POI." Every human-facing string is emitted already
// localized to the request's language — the player displays `message` as-is.
export const WayfindingAiResolutionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('DESTINATION'),
    poiId: z.string().min(1),
    message: z.string().max(WAYFINDING_AI_MAX_MESSAGE_CHARS),
  }),
  z.object({
    type: z.literal('NEAREST_DESTINATION'),
    candidatePoiIds: z.array(z.string().min(1)).min(1).max(WAYFINDING_AI_MAX_CANDIDATES),
    message: z.string().max(WAYFINDING_AI_MAX_MESSAGE_CHARS),
  }),
  z.object({
    type: z.literal('CLARIFICATION'),
    message: z.string().max(WAYFINDING_AI_MAX_MESSAGE_CHARS),
    alternatives: z.array(ClarificationAlternativeSchema).min(1).max(WAYFINDING_AI_MAX_ALTERNATIVES),
  }),
  z.object({
    type: z.literal('NO_MATCH'),
    message: z.string().max(WAYFINDING_AI_MAX_MESSAGE_CHARS),
  }),
  z.object({
    type: z.literal('UNAVAILABLE'),
    message: z.string().max(WAYFINDING_AI_MAX_MESSAGE_CHARS),
  }),
]);
export type WayfindingAiResolution = z.infer<typeof WayfindingAiResolutionSchema>;

// The structured shape the AI provider itself must return, before server-side POI-membership
// validation (§7.4) ever turns it into a WayfindingAiResolution. Deliberately narrower than
// WayfindingAiResolution: the provider can never itself produce UNAVAILABLE (that's a Lumina-only
// outcome for provider failure/timeout/quota), and every id here is untrusted until the resolver
// checks it against the server-loaded destination catalog.
export const ProviderResolutionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('DESTINATION'), poiId: z.string().min(1), message: z.string().max(WAYFINDING_AI_MAX_MESSAGE_CHARS) }),
  z.object({
    type: z.literal('NEAREST_DESTINATION'),
    candidatePoiIds: z.array(z.string().min(1)).min(1).max(WAYFINDING_AI_MAX_CANDIDATES),
    message: z.string().max(WAYFINDING_AI_MAX_MESSAGE_CHARS),
  }),
  z.object({
    type: z.literal('CLARIFICATION'),
    message: z.string().max(WAYFINDING_AI_MAX_MESSAGE_CHARS),
    alternativePoiIds: z.array(z.string().min(1)).min(1).max(WAYFINDING_AI_MAX_ALTERNATIVES),
  }),
  z.object({ type: z.literal('NO_MATCH'), message: z.string().max(WAYFINDING_AI_MAX_MESSAGE_CHARS) }),
]);
export type ProviderResolution = z.infer<typeof ProviderResolutionSchema>;

// The bounded destination catalog the API loads server-side and hands to the provider —
// deliberately excludes route geometry, coordinates, and any other tenant data the plan's
// privacy default (§3.7) doesn't require the provider to see.
export interface WayfindingAiDestination {
  id: string;
  name: string;
  nameAr: string | null;
  aliases: Array<{ value: string; language: string }>;
  category: string;
  floorLabel: string;
  status: 'OPEN' | 'CLOSED' | 'RELOCATED';
  description: string | null;
  descriptionAr: string | null;
}

export const WAYFINDING_AI_USAGE_OUTCOMES = [
  'EXACT_MATCH',
  'MODEL_DESTINATION',
  'CLARIFICATION',
  'NO_MATCH',
  'CLOSED_DESTINATION',
  'RATE_LIMITED',
  'QUOTA_EXCEEDED',
  'PROVIDER_TIMEOUT',
  'PROVIDER_ERROR',
  'INVALID_PROVIDER_OUTPUT',
] as const;
export const WayfindingAiUsageOutcomeSchema = z.enum(WAYFINDING_AI_USAGE_OUTCOMES);
export type WayfindingAiUsageOutcome = z.infer<typeof WayfindingAiUsageOutcomeSchema>;

// Dashboard configuration write (PUT /v1/wayfinding-ai/screens/:screenId/config).
export const UpdateWayfindingAiScreenConfigSchema = z.object({
  enabled: z.boolean(),
  welcomeMessage: z.string().min(1).max(WAYFINDING_AI_MAX_MESSAGE_CHARS),
  welcomeMessageAr: z.string().min(1).max(WAYFINDING_AI_MAX_MESSAGE_CHARS),
  maxTurns: z.int().min(1).max(WAYFINDING_AI_MAX_RECENT_TURNS),
});
export type UpdateWayfindingAiScreenConfigInput = z.infer<typeof UpdateWayfindingAiScreenConfigSchema>;

// Dashboard "test assistant" console (POST /v1/wayfinding-ai/test-resolve) — authenticated as a
// dashboard user against a chosen building, never a physical screen token, and never mutates
// player state.
export const TestResolveWayfindingAiSchema = z.object({
  buildingId: z.string().min(1),
  message: z.string().min(1).max(WAYFINDING_AI_MAX_INPUT_CHARS),
  language: WayfindingAiLanguageSchema,
});
export type TestResolveWayfindingAiInput = z.infer<typeof TestResolveWayfindingAiSchema>;
