import { Module } from '@nestjs/common';
import { PairingCleanupService } from './pairing-cleanup.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  providers: [PairingCleanupService, PrismaService],
})
export class PairingCleanupModule {}
