import { IsEnum } from 'class-validator';
import { UserRole } from '@lumina/db';

export class UpdateMemberRoleDto {
  @IsEnum(UserRole)
  role!: UserRole;
}
