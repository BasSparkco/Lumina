import { IsInt, IsString, IsOptional, MinLength } from 'class-validator';

export class CreateFloorDto {
  @IsInt()
  level!: number;

  @IsString()
  @MinLength(1)
  label!: string;

  @IsString()
  @IsOptional()
  floorPlanAssetId?: string;
}
