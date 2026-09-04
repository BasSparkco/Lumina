import { IsArray, IsEmail, IsString, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ModuleAssignmentDto } from './module-assignment.dto';

export class CreateTenantDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  // Explicit, not auto-derived from `name` — unlike the public self-register flow (which can't
  // be trusted to pick a clean/unique slug and just timestamps its way around collisions), a
  // Super Admin provisioning a real customer wants control over the exact value.
  @IsString()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase alphanumeric segments separated by single hyphens',
  })
  slug!: string;

  @IsEmail()
  ownerEmail!: string;

  // The tenant gets exactly the modules listed here — nothing implied, no default core-module
  // row (SIGNAGE_CORE isn't an optional row at all; see @lumina/types). An empty array is a
  // valid tenant with no optional modules yet.
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ModuleAssignmentDto)
  modules!: ModuleAssignmentDto[];
}
