import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { WAYFINDING_AI_LANGUAGES, WAYFINDING_AI_MAX_INPUT_CHARS, WAYFINDING_AI_MAX_RECENT_TURNS } from '@lumina/types';

class ConversationTurnDto {
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';

  @IsString()
  @MaxLength(WAYFINDING_AI_MAX_INPUT_CHARS)
  text!: string;
}

// Player -> API request body. The server derives screenId/organizationId/building/catalog from
// the authenticated screen token (see WayfindingAiPlayerController) — nothing here can select
// another screen, tenant, building, or POI catalog.
export class ResolveWayfindingAiDto {
  @IsString()
  @MaxLength(WAYFINDING_AI_MAX_INPUT_CHARS)
  message!: string;

  @IsIn(WAYFINDING_AI_LANGUAGES)
  language!: 'en' | 'ar';

  @IsArray()
  @IsOptional()
  @ArrayMaxSize(WAYFINDING_AI_MAX_RECENT_TURNS)
  @ValidateNested({ each: true })
  @Type(() => ConversationTurnDto)
  recentTurns?: ConversationTurnDto[];
}

// Dashboard "test assistant" console — authenticated as a dashboard user against a chosen
// building, never a physical screen token, and never mutates player state.
export class TestResolveWayfindingAiDto {
  @IsString()
  buildingId!: string;

  @IsString()
  @MaxLength(WAYFINDING_AI_MAX_INPUT_CHARS)
  message!: string;

  @IsIn(WAYFINDING_AI_LANGUAGES)
  language!: 'en' | 'ar';
}
