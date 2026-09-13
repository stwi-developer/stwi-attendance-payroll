import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
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
    const aggregate = await this.prisma.securityDepositTransaction.aggregate({
      where: { employeeId },
      _sum: { amount: true },
    });
    const value = aggregate._sum.amount as Decimal | null;
    return value ? Number(value) : 0;
  }
}
