import { IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ModuleAssignmentDto } from './module-assignment.dto';

// The full desired module state for the tenant, not a partial patch — EntitlementsService's
// dependency validation checks each assignment against the others in this same array (see
// EntitlementsService.validateDependencies), so a module and the dependency it requires must be
// submitted together.
export class SetTenantModulesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ModuleAssignmentDto)
  assignments!: ModuleAssignmentDto[];
}
