import { IsEmail } from 'class-validator';

export class OwnerInviteDto {
  @IsEmail()
  email!: string;
}
