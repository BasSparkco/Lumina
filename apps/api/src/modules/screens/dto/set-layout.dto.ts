import { IsOptional, IsString } from 'class-validator';

export class SetLayoutDto {
  @IsOptional()
  @IsString()
  layoutId!: string | null;
}
