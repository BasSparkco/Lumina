import { IsString, IsArray, ValidateNested, IsNumber, IsOptional, IsIn, IsObject, IsBoolean, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

const ZONE_TYPES = ['MEDIA', 'PRAYER', 'WEATHER', 'CURRENCY', 'TICKER', 'TIME', 'DATE', 'QR'] as const;
const ZONE_SHAPES = ['rectangle', 'rounded', 'circle', 'triangle', 'pentagon', 'hexagon', 'octagon', 'star', 'arrow'] as const;

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
  @IsIn(ZONE_SHAPES) @IsOptional() shape?: typeof ZONE_SHAPES[number];
  // Locks the zone in the editor canvas — see the matching Prisma column comment.
  @IsBoolean() @IsOptional() editable?: boolean;
  @IsObject() @IsOptional() widgetConfig?: Record<string, unknown>;
  // Mutually exclusive — a MEDIA zone plays either a playlist or a single asset, never both
  // (enforced in LayoutsService, not here, since it needs a DB lookup either way).
  @IsString() @IsOptional() playlistId?: string;
  @IsString() @IsOptional() assetId?: string;
  @IsBoolean() @IsOptional() audioPriority?: boolean;
  @IsNumber() @Min(0) @Max(100) @IsOptional() audioVolume?: number | null;
  // Per-placement image/video framing for a zone playing a direct assetId (see the matching
  // Prisma column comment) — mirrors PlaylistItem's crop fields.
  @IsNumber() @Min(1) @Max(4) @IsOptional() cropZoom?: number | null;
  @IsNumber() @IsOptional() cropOffsetX?: number | null;
  @IsNumber() @IsOptional() cropOffsetY?: number | null;
}

export class CreateLayoutDto {
  @IsString() name!: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => ZoneDto) zones!: ZoneDto[];
}
