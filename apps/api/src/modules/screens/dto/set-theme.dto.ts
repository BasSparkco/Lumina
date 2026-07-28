import { IsOptional, IsString } from 'class-validator';

export class SetThemeDto {
  @IsOptional()
  @IsString()
  themeId!: string | null;
}
