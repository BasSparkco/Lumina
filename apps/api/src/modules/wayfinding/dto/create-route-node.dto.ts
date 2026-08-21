import { IsString, IsOptional, IsNumber, Min, Max, MinLength } from 'class-validator';

export class CreateRouteNodeDto {
  @IsNumber()
  @Min(0)
  @Max(100)
  x!: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  y!: number;

  @IsString()
  @IsOptional()
  @MinLength(1)
  label?: string;
}
