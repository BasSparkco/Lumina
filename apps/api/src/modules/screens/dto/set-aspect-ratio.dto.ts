import { IsIn } from 'class-validator';

export class SetAspectRatioDto {
  @IsIn(['16:9', '9:16', 'stretch'])
  aspectRatio!: '16:9' | '9:16' | 'stretch';
}
