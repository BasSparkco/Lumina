import { IsString, MinLength } from 'class-validator';

export class CreateScreenGroupDto {
  @IsString()
  @MinLength(1)
  name!: string;
}
