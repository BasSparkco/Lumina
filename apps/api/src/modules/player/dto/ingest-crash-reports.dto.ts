import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDateString, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

export const CRASH_TYPES = ['UNCAUGHT_EXCEPTION', 'WATCHDOG_RECOVERY'] as const;
export type CrashType = (typeof CRASH_TYPES)[number];

class CrashReportEventDto {
  @IsIn(CRASH_TYPES)
  type!: CrashType;

  @IsString()
  @MaxLength(500)
  summary!: string;

  @IsOptional()
  @IsString()
  stackTrace?: string;

  @IsDateString()
  occurredAt!: string;
}

// Same buffer-then-flush shape as IngestProofOfPlayDto — a crashing device flushes whatever
// it accumulated locally on next connectivity, not one report per request.
export class IngestCrashReportsDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CrashReportEventDto)
  events!: CrashReportEventDto[];
}
