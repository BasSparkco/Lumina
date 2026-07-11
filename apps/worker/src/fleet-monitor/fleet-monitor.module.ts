import { Module } from '@nestjs/common';
import { FleetMonitorService } from './fleet-monitor.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  providers: [FleetMonitorService, PrismaService],
})
export class FleetMonitorModule {}
