import { IsEmail, IsEnum } from 'class-validator';
import { UserRole } from '@lumina/db';

export class InviteMemberDto {
  @IsEmail()
  email!: string;

  @IsEnum(UserRole)
  role!: UserRole;
}
