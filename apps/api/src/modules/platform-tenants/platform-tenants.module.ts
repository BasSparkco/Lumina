import { Module } from '@nestjs/common';
import { PlatformTenantsService } from './platform-tenants.service';
import { PlatformTenantsController } from './platform-tenants.controller';
import { AuditModule } from '../audit/audit.module';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { OrgModule } from '../org/org.module';

@Module({
  imports: [AuditModule, EntitlementsModule, OrgModule],
  providers: [PlatformTenantsService],
  controllers: [PlatformTenantsController],
})
export class PlatformTenantsModule {}
