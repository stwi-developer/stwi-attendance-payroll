import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const password = process.env.SEED_PASSWORD ?? 'ChangeMe123!';
  const passwordHash = await bcrypt.hash(password, 12);
  const users = [
    { email: 'ceo@company.local', name: 'CEO', role: UserRole.CEO },
    { email: 'hr@company.local', name: 'HR', role: UserRole.HR },
    { email: 'jrhr@company.local', name: 'Junior HR', role: UserRole.JUNIOR_HR },
  ];
  for (const user of users) {
    await prisma.user.upsert({ where: { email: user.email }, update: { passwordHash, name: user.name, role: user.role, status: 'ACTIVE' }, create: { ...user, passwordHash } });
  }
  const departmentNames = ['General', 'Administration', 'Accounts', 'IT', 'Operations'];
  const designationNames = ['Employee', 'Executive', 'Manager', 'HR', 'Accounts Executive'];
  for (const name of departmentNames) await prisma.department.upsert({ where: { name }, update: { active: true }, create: { name } });
  for (const name of designationNames) await prisma.designation.upsert({ where: { name }, update: { active: true }, create: { name } });

  const rules = [
    ['paid_leave_allowance', '1.5', 'Monthly paid leave allowance; no carry-forward.'],
    ['late_mark_threshold', '3', 'Every 3 late marks create 1 leave deduction.'],
    ['leave_per_threshold', '1', 'Leave days generated per late-mark threshold.'],
    ['normal_login', '09:30', 'Normal present expected login time.'],
    ['first_half_login', '14:30', 'Expected login for First Half STWI Leave.'],
    ['ptax_threshold', '12000', 'P.Tax applies when monthly gross salary is strictly greater than ₹12,000.'],
    ['ptax_amount', '200', 'P.Tax amount at or above threshold.'],
    ['half_day_min_hours', '4', 'Minimum worked hours for half-day STWI leave.'],
    ['half_day_max_hours', '5.5', 'Upper legacy boundary; values outside the configured range go to review.'],
    ['double_deduction_leave_days', '1', 'Manual-review tick creates one additional deduction day.'],
  ];
  for (const [key, value, description] of rules) {
    const existing = await prisma.ruleDefinition.findFirst({ where: { key, effectiveTo: null }, orderBy: { effectiveFrom: 'desc' } });
    if (!existing) await prisma.ruleDefinition.create({ data: { key, value, description, effectiveFrom: new Date('2026-01-01T00:00:00.000Z') } });
  }
  console.log(`Seeded users. Password: ${password}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
