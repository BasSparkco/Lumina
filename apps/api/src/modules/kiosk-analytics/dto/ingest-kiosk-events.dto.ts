import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator';

const KIOSK_EVENT_TYPES = ['SESSION_START', 'SEARCH', 'POI_VIEW'] as const;

class KioskEventDto {
  @IsIn(KIOSK_EVENT_TYPES)
  type!: (typeof KIOSK_EVENT_TYPES)[number];

  @IsOptional()
  @IsString()
  query?: string;

  @IsOptional()
  @IsString()
  poiId?: string;

  @IsOptional()
  @IsString()
  poiName?: string;
}

export class IngestKioskEventsDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => KioskEventDto)
  events!: KioskEventDto[];
}
