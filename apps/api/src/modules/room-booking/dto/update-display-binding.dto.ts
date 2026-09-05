import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsString, Max, Min } from 'class-validator';
import { MAX_QUICK_BOOKING_DURATIONS } from '@lumina/types';

export class UpdateDisplayBindingDto {
  @IsString()
  roomId!: string;

  @IsBoolean()
  quickBookingEnabled!: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_QUICK_BOOKING_DURATIONS)
  @IsInt({ each: true })
  quickBookingDurationsMinutes!: number[];

  @IsInt()
  @Min(1)
  @Max(120)
  startingSoonMinutes!: number;
}
