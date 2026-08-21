import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

// Must match the keys `adhan`'s CalculationMethod actually exports (see PrayerZoneWidget.tsx /
// packages/prayer) — CalculationMethod[method]() throws on the player if an unrecognized string
// ever made it into the DB, and this field previously had no validation at all.
const PRAYER_METHODS = [
  'MuslimWorldLeague', 'Egyptian', 'Karachi', 'UmmAlQura', 'Dubai',
  'MoonsightingCommittee', 'NorthAmerica', 'Kuwait', 'Qatar', 'Singapore',
  'Tehran', 'Turkey', 'Other',
] as const;

export class UpdatePrayerDto {
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @IsOptional()
  @IsIn(PRAYER_METHODS)
  prayerMethod?: (typeof PRAYER_METHODS)[number];

  @IsOptional()
  @IsBoolean()
  athanEnabled?: boolean;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsBoolean()
  timezoneEnabled?: boolean;
}
