import { IsString, IsIn, IsObject, IsArray, IsOptional } from 'class-validator';

const THEME_CATEGORIES = ['RESTAURANT_MENU', 'RETAIL_PROMO', 'HOTEL_LOBBY', 'CLINIC_WAITING', 'MOSQUE', 'GENERIC'] as const;

// Outer shape only — class-validator can't express the discriminated-union element JSON,
// so palette/typography/elements are re-validated against the zod ThemeInputSchema in the
// service, which is the authoritative check.
export class ThemeDto {
  @IsString() name!: string;
  @IsIn(THEME_CATEGORIES) category!: typeof THEME_CATEGORIES[number];
  @IsString() @IsOptional() aspectRatio?: string;
  @IsObject() palette!: Record<string, unknown>;
  @IsObject() typography!: Record<string, unknown>;
  @IsArray() elements!: unknown[];
}
