import { IsBoolean } from 'class-validator';

export class SetShowClockDto {
  @IsBoolean()
  showClock!: boolean;
}
