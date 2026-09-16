import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

type DepositMethod = 'FULL' | 'EMI_3_MONTHS';

@Injectable()
export class SecurityDepositService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Security deposit target is always the employee's current monthly salary.
   * For a salary increase, only the shortfall is collected:
   * additionalRequired = currentSalary - alreadyHeld.
   */
  calculateRequirement(currentSalary: number, alreadyHeld: number) {
    const requiredDeposit = Math.max(0, currentSalary);
    const additionalRequired = Math.max(0, requiredDeposit - Math.max(0, alreadyHeld));
    return { requiredDeposit, additionalRequired };
  }

  calculateInstallment(additionalRequired: number, method: DepositMethod) {
    if (additionalRequired <= 0) {
      return { installmentCount: 0, installmentAmount: 0 };
    }
    if (method === 'FULL') {
      return { installmentCount: 1, installmentAmount: additionalRequired };
    }
    return {
      installmentCount: 3,
      installmentAmount: Math.round((additionalRequired / 3) * 100) / 100,
    };
  }

  async getHeldAmount(employeeId: string): Promise<number> {
    const [latestDeposit, aggregate] = await Promise.all([
    this.prisma.securityDeposit.findFirst({
      where: { employeeId },
      orderBy: { createdAt: 'desc' },
      select: {
        alreadyHeld: true,
      },
    }),

    this.prisma.securityDepositTransaction.aggregate({
      where: { employeeId },
      _sum: { amount: true },
    }),
    ]);

    const depositHeld = latestDeposit
    ? Number(latestDeposit.alreadyHeld)
    : 0;

    const transactionHeld = aggregate._sum.amount
    ? Number(aggregate._sum.amount)
    : 0;

    return Math.max(depositHeld, transactionHeld);
  }
}
