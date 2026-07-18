import { IsString, IsInt, IsOptional, IsArray, Matches, Min } from 'class-validator';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreatePowerScheduleDto {
  @IsString() @IsOptional() screenId?: string;
  @IsString() @IsOptional() groupId?: string;

  @IsArray() @IsInt({ each: true }) @Min(0, { each: true }) @IsOptional()
  daysOfWeek?: number[];

  @IsString() @Matches(TIME_RE, { message: 'startTime must be HH:MM' })
  startTime!: string;

  @IsString() @Matches(TIME_RE, { message: 'endTime must be HH:MM' })
  endTime!: string;
}
