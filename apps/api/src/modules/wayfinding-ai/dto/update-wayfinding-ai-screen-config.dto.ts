import { IsBoolean, IsInt, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { WAYFINDING_AI_MAX_MESSAGE_CHARS, WAYFINDING_AI_MAX_RECENT_TURNS } from '@lumina/types';

export class UpdateWayfindingAiScreenConfigDto {
  @IsBoolean()
  enabled!: boolean;

  @IsString()
  @MinLength(1)
  @MaxLength(WAYFINDING_AI_MAX_MESSAGE_CHARS)
  welcomeMessage!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(WAYFINDING_AI_MAX_MESSAGE_CHARS)
  welcomeMessageAr!: string;

  @IsInt()
  @Min(1)
  @Max(WAYFINDING_AI_MAX_RECENT_TURNS)
  maxTurns!: number;
}
