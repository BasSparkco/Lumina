import { Module } from '@nestjs/common';
import { PlatformTenantsService } from './platform-tenants.service';
import { PlatformTenantsController } from './platform-tenants.controller';
import { AuditModule } from '../audit/audit.module';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { OrgModule } from '../org/org.module';
import { WsModule } from '../ws/ws.module';

@Module({
  imports: [AuditModule, EntitlementsModule, OrgModule, WsModule],
  providers: [PlatformTenantsService],
  controllers: [PlatformTenantsController],
})
export class PlatformTenantsModule {}
