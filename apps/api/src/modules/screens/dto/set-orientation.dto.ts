import { IsIn } from 'class-validator';

export class SetOrientationDto {
  @IsIn([0, 90, 180, 270])
  orientation!: 0 | 90 | 180 | 270;
}
