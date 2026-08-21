import { IsString, IsOptional, MinLength, Matches } from 'class-validator';

export class CreatePoiCategoryDto {
  @IsString()
  @MinLength(1)
  label!: string;

  @IsString()
  @IsOptional()
  labelAr?: string;

  @IsString()
  @MinLength(1)
  icon!: string;

  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'color must be a #RRGGBB hex value' })
  color!: string;
}
