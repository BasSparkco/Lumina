import { IsOptional, IsString } from 'class-validator';

export class SetKioskAttractThemeDto {
  @IsOptional()
  @IsString()
  themeId!: string | null;
}
