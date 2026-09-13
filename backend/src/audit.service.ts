import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}
  async log(data: { userId?: string; employeeId?: string; action: string; entityType: string; entityId: string; beforeJson?: unknown; afterJson?: unknown }) {
    return this.prisma.auditLog.create({ data: {
      userId: data.userId,
      employeeId: data.employeeId,
      action: data.action,
      entityType: data.entityType,
      entityId: data.entityId,
      beforeJson: data.beforeJson as any,
      afterJson: data.afterJson as any,
    }});
  }
}
