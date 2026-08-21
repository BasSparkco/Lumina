import { Global, Module } from '@nestjs/common';
import { OrgScopedService } from './org-scoped.service';

// Global, same as PrismaModule — OrgScopedService is a zero-dependency, stateless helper that
// nearly every feature module's service wants, so requiring each one to import this module
// individually would just be boilerplate with no real benefit.
@Global()
@Module({
  providers: [OrgScopedService],
  exports: [OrgScopedService],
})
export class OrgScopedModule {}
