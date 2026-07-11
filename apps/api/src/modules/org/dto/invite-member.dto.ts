import { IsEmail, IsEnum } from 'class-validator';
import { UserRole } from '@prisma/client';

export class InviteMemberDto {
  @IsEmail()
  email!: string;

  @IsEnum(UserRole)
  role!: UserRole;
}
