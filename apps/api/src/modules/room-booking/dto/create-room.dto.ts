import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { MAX_AMENITIES, MAX_ROOM_NAME_LENGTH, MIN_ROOM_NAME_LENGTH, ROOM_PRIVACY_MODES, BOOKABLE_ROOM_STATUSES } from '@lumina/types';

export class CreateRoomDto {
  @IsString()
  @MinLength(MIN_ROOM_NAME_LENGTH)
  @MaxLength(MAX_ROOM_NAME_LENGTH)
  name!: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  locationLabel?: string;

  @IsString()
  @MinLength(1)
  timezone!: string;

  @IsInt()
  @Min(0)
  @Max(10000)
  @IsOptional()
  capacity?: number;

  @IsArray()
  @ArrayMaxSize(MAX_AMENITIES)
  @IsString({ each: true })
  @IsOptional()
  amenities?: string[];

  @IsIn(ROOM_PRIVACY_MODES)
  @IsOptional()
  privacyMode?: (typeof ROOM_PRIVACY_MODES)[number];

  @IsIn(BOOKABLE_ROOM_STATUSES)
  @IsOptional()
  status?: (typeof BOOKABLE_ROOM_STATUSES)[number];

  @IsString()
  @IsOptional()
  wayfindingPoiId?: string | null;
}
