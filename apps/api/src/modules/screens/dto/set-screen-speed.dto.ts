import { IsNumber, Max, Min } from 'class-validator';

export class SetScreenSpeedDto {
  @IsNumber()
  @Min(0.25)
  @Max(3)
  rate!: number;
}
