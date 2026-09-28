import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}
  async summary() {
    const employees = await this.prisma.employee.count({ where: { status: 'ACTIVE', deletedAt: null } });
    const latestRun = await this.prisma.payrollRun.findFirst({ orderBy: [{ year: 'desc' }, { month: 'desc' }] });
    let runStats: any = null;
    if (latestRun) {
      const [reviewsOpen, files, payrollResults] = await Promise.all([
        this.prisma.manualReview.count({ where: { payrollRunId: latestRun.id, status: 'OPEN' } }),
        this.prisma.attendanceFile.count({ where: { payrollRunId: latestRun.id } }),
        this.prisma.payrollResult.count({ where: { payrollRunId: latestRun.id } }),
      ]);
      runStats = { id: latestRun.id, year: latestRun.year, month: latestRun.month, status: latestRun.status, reviewsOpen, files, payrollResults };
    }
    // V1.9: "Payroll Results" = number of finalized months (STWI, 28 Sep)
    const finalizedRuns = await this.prisma.payrollRun.count({ where: { status: 'FINALIZED' } });
    const openReviews = await this.prisma.manualReview.count({ where: { status: 'OPEN' } });
    return { employees, latestRun: runStats, finalizedRuns, openReviews };
  }
}
