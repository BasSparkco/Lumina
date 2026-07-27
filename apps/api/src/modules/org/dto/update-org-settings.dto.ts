import { IsBoolean } from 'class-validator';

export class UpdateOrgSettingsDto {
  @IsBoolean()
  autoPublish!: boolean;
}
