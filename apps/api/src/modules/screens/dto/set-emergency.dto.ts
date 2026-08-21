import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class SetEmergencyDto {
  @IsBoolean()
  active!: boolean;

  @IsOptional()
  @IsString()
  playlistId?: string;
}
