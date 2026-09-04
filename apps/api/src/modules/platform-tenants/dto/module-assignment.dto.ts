import { IsIn, IsISO8601, IsOptional } from 'class-validator';
import { MODULE_KEYS, TENANT_MODULE_STATUSES, type ModuleKey, type TenantModuleStatus } from '@lumina/types';

// Shared by CreateTenantDto and SetTenantModulesDto — one module's desired end state. `key`/
// `status` are validated against the shared catalog (@lumina/types), never a locally duplicated
// string union, per docs/adr/platform-modules-and-entitlements.md.
export class ModuleAssignmentDto {
  @IsIn(MODULE_KEYS)
  key!: ModuleKey;

  @IsIn(TENANT_MODULE_STATUSES)
  status!: TenantModuleStatus;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}
