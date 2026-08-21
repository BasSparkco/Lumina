import { IsBoolean } from 'class-validator';

export class SetStoppedDto {
  @IsBoolean()
  stopped!: boolean;
}
