import { IsOptional, IsString } from 'class-validator';

export class AssignAssetDto {
  @IsOptional()
  @IsString()
  assetId!: string | null;
}
