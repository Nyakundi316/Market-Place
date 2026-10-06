import { Global, Injectable, Module } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.module';

export interface AuditEntry {
  actorId: string | null;
  action: string; // dotted verb, e.g. "user.register", "order.refund"
  entityType: string;
  entityId: string;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly db: PrismaService) {}

  /** Pass `tx` to write inside the same transaction as the change being audited. */
  log(entry: AuditEntry, tx: Prisma.TransactionClient = this.db) {
    return tx.auditLog.create({ data: entry });
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
