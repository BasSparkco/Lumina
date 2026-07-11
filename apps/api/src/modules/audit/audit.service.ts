import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@lumina/db';
import { PrismaService } from '../../prisma/prisma.service';

interface AuditEntry {
  organizationId: string;
  userId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  metadata?: Prisma.InputJsonValue;
}

interface AuditQueryOptions {
  resourceType?: string;
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Swallows its own errors — a broken audit write must never fail the request that triggered it.
  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({ data: entry });
    } catch (err) {
      this.logger.error(`Failed to write audit log: ${(err as Error).message}`);
    }
  }

  async query(orgId: string, opts: AuditQueryOptions) {
    const where = {
      organizationId: orgId,
      ...(opts.resourceType ? { resourceType: opts.resourceType } : {}),
      ...(opts.from ?? opts.to
        ? { createdAt: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) } }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (opts.page - 1) * opts.pageSize,
        take: opts.pageSize,
        include: { user: { select: { id: true, name: true, email: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { items, total, page: opts.page, pageSize: opts.pageSize };
  }
}
