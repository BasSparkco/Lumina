import { IsInt, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

// docs/modules/room_booking_module_plan.md §8.4 — deliberately cannot specify organizationId,
// roomId, start time, organizer, or another screen; the server derives all of that from the
// authenticated screen's binding.
export class BookNowDto {
  @IsInt()
  @Min(1)
  @Max(24 * 60)
  durationMinutes!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  idempotencyKey!: string;
}
