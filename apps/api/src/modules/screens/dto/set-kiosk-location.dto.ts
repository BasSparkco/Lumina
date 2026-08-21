import { IsString, IsNumber, Min, Max } from 'class-validator';

export class SetKioskLocationDto {
  @IsString()
  floorId!: string;

  @IsNumber()
  @Min(0)
  @Max(100)
  x!: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  y!: number;
}
