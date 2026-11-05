import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { BLOCKING_REVIEW } from '../runs/runs.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}
  async summary() {
    const employees = await this.prisma.employee.count({ where: { status: 'ACTIVE', deletedAt: null } });
    const latestRun = await this.prisma.payrollRun.findFirst({ orderBy: [{ year: 'desc' }, { month: 'desc' }] });
    let runStats: any = null;
    if (latestRun) {
      const [reviewsOpen, files, payrollResults] = await Promise.all([
        // KP-29: only items that block Calculate (not the leaver information item)
        this.prisma.manualReview.count({ where: { payrollRunId: latestRun.id, status: 'OPEN', ...BLOCKING_REVIEW } }),
        this.prisma.attendanceFile.count({ where: { payrollRunId: latestRun.id } }),
        this.prisma.payrollResult.count({ where: { payrollRunId: latestRun.id } }),
      ]);
      runStats = { id: latestRun.id, year: latestRun.year, month: latestRun.month, status: latestRun.status, reviewsOpen, files, payrollResults };
    }
    // V1.9: "Payroll Results" = number of finalized months (STWI, 28 Sep)
    const finalizedRuns = await this.prisma.payrollRun.count({ where: { status: 'FINALIZED' } });
    const openReviews = await this.prisma.manualReview.count({ where: { status: 'OPEN', ...BLOCKING_REVIEW, payrollRun: { status: { not: 'FINALIZED' } } } });
    return { employees, latestRun: runStats, finalizedRuns, openReviews };
  }
}
