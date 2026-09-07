import { IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateTenantNameDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;
}
