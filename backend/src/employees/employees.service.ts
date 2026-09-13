import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit.service';
import { parsePagination, paged } from '../utils/pagination';

@Injectable()
export class EmployeesService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async list(query: {
    page?: string;
    pageSize?: string;
    search?: string;
    status?: 'ACTIVE' | 'INACTIVE';
    departmentId?: string;
    designationId?: string;
    minSalary?: string;
    maxSalary?: string;
  }) {
    const { page, pageSize, skip } = parsePagination(query.page, query.pageSize);
    const search = query.search?.trim();
    const minSalary = query.minSalary === undefined || query.minSalary === '' ? undefined : Number(query.minSalary);
    const maxSalary = query.maxSalary === undefined || query.maxSalary === '' ? undefined : Number(query.maxSalary);

    const where: any = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(query.designationId ? { designationId: query.designationId } : {}),
      ...(search
        ? {
            OR: [
              { employeeCode: { contains: search } },
              { name: { contains: search } },
              { email: { contains: search } },
            ],
          }
        : {}),
    };

    const employees = await this.prisma.employee.findMany({
      where,
      include: {
        department: true,
        designation: true,
        salaryHistory: { orderBy: { effectiveFrom: 'desc' }, take: 1 },
        deposits: { include: { transactions: true }, orderBy: { createdAt: 'desc' } },
      },
      orderBy: { name: 'asc' },
    });

    const filtered = employees.filter((employee) => {
      const salary = Number(employee.salaryHistory[0]?.grossSalary ?? 0);
      if (minSalary !== undefined && Number.isFinite(minSalary) && salary < minSalary) return false;
      if (maxSalary !== undefined && Number.isFinite(maxSalary) && salary > maxSalary) return false;
      return true;
    });

    return paged(filtered.slice(skip, skip + pageSize), filtered.length, page, pageSize);
  }

  async get(id: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id },
      include: {
        department: true,
        designation: true,
        salaryHistory: { orderBy: { effectiveFrom: 'desc' } },
        deposits: { include: { transactions: { orderBy: { transactionDate: 'asc' } } }, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    return employee;
  }

  async create(data: { employeeCode: string; name: string; email?: string; joiningDate?: string; departmentId?: string; designationId?: string; grossSalary: number; salaryEffectiveFrom?: string }) {
    const employeeCode = data.employeeCode.trim();
    const existing = await this.prisma.employee.findUnique({ where: { employeeCode } });
    if (existing) throw new ConflictException('Employee code already exists');

    const effectiveFrom = data.salaryEffectiveFrom ? new Date(data.salaryEffectiveFrom) : new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const employee = await tx.employee.create({
        data: {
          employeeCode,
          name: data.name.trim(),
          email: data.email?.trim().toLowerCase(),
          joiningDate: data.joiningDate ? new Date(data.joiningDate) : undefined,
          departmentId: data.departmentId || undefined,
          designationId: data.designationId || undefined,
        },
      });
      await tx.employeeSalary.create({ data: { employeeId: employee.id, effectiveFrom, grossSalary: data.grossSalary } });
      return tx.employee.findUnique({
        where: { id: employee.id },
        include: {
          department: true,
          designation: true,
          salaryHistory: { orderBy: { effectiveFrom: 'desc' } },
          deposits: { include: { transactions: true } },
        },
      });
    });
    if (!result) throw new NotFoundException('Employee could not be created');
    await this.audit.log({ action: 'CREATE', entityType: 'Employee', entityId: result.id, employeeId: result.id, afterJson: result });
    return result;
  }

  async remove(userId: string, id: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id },
      include: {
        salaryHistory: true,
        attendance: { take: 1 },
        payrolls: { take: 1 },
        reviews: { take: 1 },
        deposits: { take: 1 },
      },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    const hasHistory = employee.attendance.length || employee.payrolls.length || employee.reviews.length || employee.deposits.length;
    if (hasHistory) {
      throw new ConflictException('Employee has attendance/payroll/security-deposit history. Deactivate the employee instead of deleting historical records.');
    }
    await this.prisma.employee.delete({ where: { id } });
    await this.audit.log({ userId, action: 'DELETE', entityType: 'Employee', entityId: id, employeeId: id, beforeJson: employee });
    return { deleted: true, id };
  }

  async update(id: string, data: { name?: string; email?: string; joiningDate?: string; departmentId?: string; designationId?: string; status?: 'ACTIVE' | 'INACTIVE'; grossSalary?: number; salaryEffectiveFrom?: string }) {
    const existing = await this.prisma.employee.findUnique({ where: { id }, include: { salaryHistory: { orderBy: { effectiveFrom: 'desc' }, take: 1 } } });
    if (!existing) throw new NotFoundException('Employee not found');

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.employee.update({
        where: { id },
        data: {
          name: data.name?.trim(),
          email: data.email?.trim().toLowerCase(),
          joiningDate: data.joiningDate ? new Date(data.joiningDate) : undefined,
          departmentId: data.departmentId || undefined,
          designationId: data.designationId || undefined,
          status: data.status,
        },
      });
      if (data.grossSalary !== undefined) {
        const current = existing.salaryHistory[0] ? Number(existing.salaryHistory[0].grossSalary) : undefined;
        if (current === undefined || current !== data.grossSalary) {
          await tx.employeeSalary.create({
            data: {
              employeeId: id,
              effectiveFrom: data.salaryEffectiveFrom ? new Date(data.salaryEffectiveFrom) : new Date(),
              grossSalary: data.grossSalary,
              notes: current !== undefined ? `Salary changed from ${current} to ${data.grossSalary}` : undefined,
            },
          });
        }
      }
      return tx.employee.findUnique({
        where: { id },
        include: {
          department: true,
          designation: true,
          salaryHistory: { orderBy: { effectiveFrom: 'desc' } },
          deposits: { include: { transactions: true } },
        },
      });
    });
    await this.audit.log({ action: 'UPDATE', entityType: 'Employee', entityId: id, employeeId: id, beforeJson: existing, afterJson: result });
    return result;
  }
}
