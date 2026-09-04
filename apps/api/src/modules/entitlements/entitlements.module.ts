import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { EntitlementsService } from './entitlements.service';
import { ModuleCatalogService } from './module-catalog.service';
import { Clock } from './clock';
import { EntitlementGuard } from './entitlement.guard';

@Module({
  imports: [AuditModule],
  providers: [EntitlementsService, ModuleCatalogService, Clock, EntitlementGuard],
  exports: [EntitlementsService, ModuleCatalogService, EntitlementGuard],
})
export class EntitlementsModule {}
