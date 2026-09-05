import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { WAYFINDING_AI_LANGUAGES } from '@lumina/types';

export class CreatePoiAliasDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  value!: string;

  @IsIn(WAYFINDING_AI_LANGUAGES)
  language!: 'en' | 'ar';
}
