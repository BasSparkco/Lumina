import { IsBoolean } from 'class-validator';

export class SetEvacuationDto {
  @IsBoolean()
  active!: boolean;
}
