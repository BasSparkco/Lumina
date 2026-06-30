import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateScreenDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  @IsOptional()
  timezone?: string;
}
