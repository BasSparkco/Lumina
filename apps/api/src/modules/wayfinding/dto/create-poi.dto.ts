import { IsString, IsOptional, IsNumber, Min, Max, IsIn, MinLength } from 'class-validator';

const POI_STATUSES = ['OPEN', 'CLOSED', 'RELOCATED'] as const;

export class CreatePoiDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @IsOptional()
  nameAr?: string;

  @IsNumber()
  @Min(0)
  @Max(100)
  x!: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  y!: number;

  @IsString()
  categoryId!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  descriptionAr?: string;

  @IsIn(POI_STATUSES)
  @IsOptional()
  status?: (typeof POI_STATUSES)[number];

  @IsString()
  @IsOptional()
  externalRef?: string;

  @IsString()
  @IsOptional()
  iconAssetId?: string;
}
