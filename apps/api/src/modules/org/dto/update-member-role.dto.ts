import { IsEnum } from 'class-validator';
import { UserRole } from '@prisma/client';

export class UpdateMemberRoleDto {
  @IsEnum(UserRole)
  role!: UserRole;
}
