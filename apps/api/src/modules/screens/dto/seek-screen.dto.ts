import { IsNumber, Min } from 'class-validator';

export class SeekScreenDto {
  @IsNumber()
  @Min(0)
  toSeconds!: number;
}
