import { IsString, IsInt, IsOptional, IsArray, Matches, Min, IsDateString } from 'class-validator';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateScheduleDto {
  @IsString() name!: string;
  @IsString() screenId!: string;
  @IsString() playlistId!: string;
  @IsInt() @IsOptional() priority?: number;

  @IsString() @IsOptional() @Matches(TIME_RE, { message: 'startTime must be HH:MM' })
  startTime?: string;

  @IsString() @IsOptional() @Matches(TIME_RE, { message: 'endTime must be HH:MM' })
  endTime?: string;

  @IsArray() @IsInt({ each: true }) @Min(0, { each: true }) @IsOptional()
  daysOfWeek?: number[];

  @IsDateString() @IsOptional() startDate?: string;
  @IsDateString() @IsOptional() endDate?: string;
}
