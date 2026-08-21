import { IsString, IsOptional, IsNumber, Min, Max, IsArray, ValidateNested, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

// One parsed CSV row — the dashboard parses the spreadsheet client-side and posts structured
// rows rather than a raw file, avoiding multipart upload handling here for what's fundamentally
// the same create-many operation as adding POIs one at a time.
export class ImportPoiRowDto {
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

  // Matched against a category's label (case-insensitive), not an id — friendlier for a
  // spreadsheet a mall already maintains than requiring them to know internal category ids.
  @IsString()
  @MinLength(1)
  categoryLabel!: string;

  @IsString()
  @IsOptional()
  description?: string;
}

export class ImportPoisDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportPoiRowDto)
  rows!: ImportPoiRowDto[];
}
