import { IsIn } from 'class-validator';
import { ORGANIZATION_STATUSES, type OrganizationStatus } from '@lumina/types';

export class UpdateTenantStatusDto {
  @IsIn(ORGANIZATION_STATUSES)
  status!: OrganizationStatus;
}
