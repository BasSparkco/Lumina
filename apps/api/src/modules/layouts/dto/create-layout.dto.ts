import { IsString, IsArray, ValidateNested, IsNumber, IsOptional, IsIn, IsObject, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

const ZONE_TYPES = ['MEDIA', 'PRAYER', 'WEATHER', 'CURRENCY', 'TICKER'] as const;

export class ZoneDto {
  @IsString() name!: string;
  @IsNumber() @Min(0) @Max(100) x!: number;
  @IsNumber() @Min(0) @Max(100) y!: number;
  @IsNumber() @Min(1) @Max(100) width!: number;
  @IsNumber() @Min(1) @Max(100) height!: number;
  @IsNumber() @IsOptional() zIndex?: number;
  @IsIn(ZONE_TYPES) @IsOptional() zoneType?: typeof ZONE_TYPES[number];
  @IsObject() @IsOptional() widgetConfig?: Record<string, unknown>;
  @IsString() @IsOptional() playlistId?: string;
}

export class CreateLayoutDto {
  @IsString() name!: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => ZoneDto) zones!: ZoneDto[];
}
