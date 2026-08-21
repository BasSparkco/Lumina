import { IsOptional, IsString } from 'class-validator';

export class SetKioskAttractPlaylistDto {
  @IsOptional()
  @IsString()
  playlistId!: string | null;
}
