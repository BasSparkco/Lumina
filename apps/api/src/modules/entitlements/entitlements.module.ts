import { Module } from '@nestjs/common';
import { PlatformAuditModule } from '../platform-audit/platform-audit.module';
import { EntitlementsService } from './entitlements.service';
import { ModuleCatalogService } from './module-catalog.service';
import { Clock } from './clock';
import { EntitlementGuard } from './entitlement.guard';

@Module({
  imports: [PlatformAuditModule],
  providers: [EntitlementsService, ModuleCatalogService, Clock, EntitlementGuard],
  exports: [EntitlementsService, ModuleCatalogService, EntitlementGuard],
})
export class EntitlementsModule {}
