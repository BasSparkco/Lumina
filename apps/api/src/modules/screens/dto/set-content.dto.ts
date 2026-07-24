import { IsIn, IsOptional, IsString } from 'class-validator';

// Drives the single "streaming type" choose box in the dashboard: a screen plays exactly one
// of a video asset, an image asset, a playlist, or a theme at a time — never several at once.
export class SetContentDto {
  @IsOptional()
  @IsIn(['VIDEO', 'IMAGE', 'PLAYLIST', 'THEME'])
  contentType!: 'VIDEO' | 'IMAGE' | 'PLAYLIST' | 'THEME' | null;

  @IsOptional()
  @IsString()
  assetId?: string | null;

  @IsOptional()
  @IsString()
  playlistId?: string | null;

  @IsOptional()
  @IsString()
  themeId?: string | null;
}
