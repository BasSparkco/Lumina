import { IsString, IsArray, ValidateNested, IsNumber, IsOptional, IsIn, IsObject, IsBoolean, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

const ZONE_TYPES = ['MEDIA', 'PRAYER', 'WEATHER', 'CURRENCY', 'TICKER'] as const;

export class ZoneDto {
  @IsString() name!: string;
  @IsNumber() @Min(0) @Max(100) x!: number;
  @IsNumber() @Min(0) @Max(100) y!: number;
  @IsNumber() @Min(1) @Max(100) width!: number;
  @IsNumber() @Min(1) @Max(100) height!: number;
  @IsNumber() @IsOptional() zIndex?: number;
  // Degrees, clockwise, about the zone's own center — free rotation, not just 90° steps.
  @IsNumber() @Min(-360) @Max(360) @IsOptional() rotation?: number;
  @IsIn(ZONE_TYPES) @IsOptional() zoneType?: typeof ZONE_TYPES[number];
  @IsObject() @IsOptional() widgetConfig?: Record<string, unknown>;
  // Mutually exclusive — a MEDIA zone plays either a playlist or a single asset, never both
  // (enforced in LayoutsService, not here, since it needs a DB lookup either way).
  @IsString() @IsOptional() playlistId?: string;
  @IsString() @IsOptional() assetId?: string;
  @IsBoolean() @IsOptional() audioPriority?: boolean;
  @IsNumber() @Min(0) @Max(100) @IsOptional() audioVolume?: number | null;
}

export class CreateLayoutDto {
  @IsString() name!: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => ZoneDto) zones!: ZoneDto[];
}
