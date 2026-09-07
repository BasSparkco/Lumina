import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StorageService } from './storage.service';
import { MediaTokenService } from './media-token.service';

@Global()
@Module({
  imports: [AuthModule],
  providers: [StorageService, MediaTokenService],
  exports: [StorageService, MediaTokenService],
})
export class StorageModule {}
