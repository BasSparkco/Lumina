import { IsOptional, IsNumber } from 'class-validator';

export class SetVolumeDto {
  @IsOptional()
  @IsNumber()
  volume!: number | null;
}
