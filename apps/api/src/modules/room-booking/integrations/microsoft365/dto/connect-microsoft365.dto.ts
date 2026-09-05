import { IsString, MaxLength, MinLength } from 'class-validator';

// docs/modules/room_booking_module_plan.md §13.4 — an Entra ID app registration with admin
// consent already granted for the least-privilege application permissions this connector needs
// (Place.Read.All, Calendars.ReadWrite). No provider token ever appears in dashboard local
// storage or a browser at all — this is a plain authenticated dashboard API call.
export class ConnectMicrosoft365Dto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  displayName!: string;

  @IsString()
  @MinLength(1)
  tenantId!: string;

  @IsString()
  @MinLength(1)
  clientId!: string;

  @IsString()
  @MinLength(1)
  clientSecret!: string;
}
