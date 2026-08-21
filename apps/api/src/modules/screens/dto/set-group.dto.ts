import { IsOptional, IsString } from 'class-validator';

export class SetGroupDto {
  @IsOptional()
  @IsString()
  groupId!: string | null;
}
