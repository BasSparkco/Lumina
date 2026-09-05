import { IsEmail, IsString } from 'class-validator';

export class MapRoomDto {
  @IsString()
  connectionId!: string;

  @IsString()
  externalResourceId!: string;

  @IsEmail()
  externalResourceEmail!: string;
}
