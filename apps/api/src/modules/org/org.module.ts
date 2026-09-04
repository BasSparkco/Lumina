import { Module } from '@nestjs/common';
import { OrgService } from './org.service';
import { OrgController } from './org.controller';
import { AuthModule } from '../auth/auth.module';
import { EntitlementsModule } from '../entitlements/entitlements.module';

@Module({
  imports: [AuthModule, EntitlementsModule],
  providers: [OrgService],
  controllers: [OrgController],
  exports: [OrgService],
})
export class OrgModule {}
