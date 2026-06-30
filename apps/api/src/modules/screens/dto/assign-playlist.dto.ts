import { IsString } from 'class-validator';

export class AssignPlaylistDto {
  @IsString()
  playlistId!: string;
}
