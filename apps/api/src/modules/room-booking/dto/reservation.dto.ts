import { IsDateString, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateReservationDto {
  @IsString()
  @IsOptional()
  @MaxLength(200)
  title?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  organizerDisplayName?: string;

  @IsDateString()
  startsAt!: string;

  @IsDateString()
  endsAt!: string;

  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(120)
  idempotencyKey?: string;
}

export class UpdateReservationDto extends CreateReservationDto {}
