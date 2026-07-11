import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDateString, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

class ProofOfPlayEventDto {
  @IsOptional()
  @IsString()
  assetId?: string;

  @IsDateString()
  playedAt!: string;

  @IsInt()
  @Min(0)
  durationMs!: number;
}

export class IngestProofOfPlayDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ProofOfPlayEventDto)
  events!: ProofOfPlayEventDto[];
}
