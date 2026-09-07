import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ORGANIZATION_STATUSES, type OrganizationStatus } from '@lumina/types';

export class UpdateTenantStatusDto {
  @IsIn(ORGANIZATION_STATUSES)
  status!: OrganizationStatus;

  // Required by PlatformTenantsService.updateStatus when status is SUSPENDED (plan §P6a "Safe
  // administrative actions": "suspend/reactivate with a required reason") — optional here so
  // reactivating doesn't need one.
  @IsString()
  @IsOptional()
  @MaxLength(500)
  reason?: string;
}
