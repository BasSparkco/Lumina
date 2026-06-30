import { Module } from '@nestjs/common';
import { ConnectorsService } from './connectors.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  providers: [ConnectorsService, PrismaService],
  exports: [ConnectorsService],
})
export class ConnectorsModule {}
