import { IsOptional, IsString } from 'class-validator';

export class AssignPlaylistDto {
  @IsOptional()
  @IsString()
  playlistId!: string | null;
}
