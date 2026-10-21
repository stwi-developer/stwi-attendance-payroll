import { BadRequestException, Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { RULE_KEYS, monthStartUTC, ruleVersionFor } from '../rules';

@UseGuards(AuthGuard, RolesGuard)
@Controller('reference')
export class ReferenceController {
  constructor(private readonly prisma: PrismaService) {}
  @Get('departments') departments() { return this.prisma.department.findMany({ where: { active: true }, include: { parent: { select: { id: true, name: true } } }, orderBy: { name: 'asc' } }); }
  @Get('employment-types') employmentTypes() { return this.prisma.employmentType.findMany({ where: { active: true }, orderBy: { name: 'asc' } }); }
  @Post('employment-types') @Roles('CEO', 'HR') createEmploymentType(@Body() body: { name: string }) { return this.upsertName('employmentType', body?.name); }
  @Get('designations') designations() { return this.prisma.designation.findMany({ where: { active: true }, orderBy: { name: 'asc' } }); }
  @Post('departments') @Roles('CEO', 'HR') createDepartment(@Body() body: { name: string }) { return this.upsertName('department', body?.name); }
  @Post('designations') @Roles('CEO', 'HR') createDesignation(@Body() body: { name: string }) { return this.upsertName('designation', body?.name); }

  // V1.9: adding a name that already exists (e.g. hidden) re-activates it instead of failing
  private async upsertName(model: 'department' | 'designation' | 'employmentType', raw?: string) {
    const name = String(raw ?? '').trim();
    if (!name) throw new BadRequestException('Name is required.');
    const delegate = this.prisma[model] as any;
    return delegate.upsert({ where: { name }, update: { active: true }, create: { name } });
  }
  // KP-12 (STWI 21 Oct): rules are dated by month (see ../rules.ts)
  @Get('rules') async rules() {
    const now = new Date();
    const y = now.getUTCFullYear(), m = now.getUTCMonth() + 1;
    const all = await this.prisma.ruleDefinition.findMany({ where: { key: { in: Object.keys(RULE_KEYS) } }, orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }] });
    const out = [];
    for (const [key, def] of Object.entries(RULE_KEYS)) {
      const current = await ruleVersionFor(this.prisma, key, y, m);
      const history = all.filter((r) => r.key === key).map((r) => ({ value: r.value, effectiveFrom: r.effectiveFrom, createdAt: r.createdAt }));
      // keep only the newest version per start month
      const seen = new Set<string>();
      const versions = history.filter((h) => { const k = h.effectiveFrom.toISOString().slice(0, 7); if (seen.has(k)) return false; seen.add(k); return true; });
      out.push({ key, label: def.label, kind: def.kind, value: current?.value ?? '', effectiveFrom: current?.effectiveFrom ?? null, description: current?.description ?? null, versions });
    }
    return out;
  }

  @Patch('rules/:key') @Roles('CEO', 'HR') async updateRule(@Body() body: { value: string; fromMonth?: string }, @Param('key') key: string) {
    const def = RULE_KEYS[key];
    if (!def) throw new BadRequestException('Unknown rule.');
    const value = String(body?.value ?? '').trim();
    if (def.kind === 'time') {
      if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(value)) throw new BadRequestException('Use a time like 09:30.');
    } else if (value === '' || !Number.isFinite(Number(value)) || Number(value) < 0) {
      throw new BadRequestException('Enter a number (0 or more).');
    }
    const fm = String(body?.fromMonth ?? '').match(/^(\d{4})-(\d{2})$/);
    const now = new Date();
    const year = fm ? Number(fm[1]) : now.getUTCFullYear();
    const month = fm ? Number(fm[2]) : now.getUTCMonth() + 1;
    if (month < 1 || month > 12 || year < 2000 || year > 2100) throw new BadRequestException('Pick a valid month.');
    const finalized = await this.prisma.payrollRun.findFirst({ where: { status: 'FINALIZED', OR: [{ year: { gt: year } }, { year, month: { gte: month } }] }, orderBy: [{ year: 'desc' }, { month: 'desc' }] });
    if (finalized) throw new BadRequestException(`${finalized.month}/${finalized.year} is already finalized. Pick a month after the last finalized month.`);
    const effectiveFrom = monthStartUTC(year, month);
    const latest = await this.prisma.ruleDefinition.findFirst({ where: { key }, orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }] });
    const same = await this.prisma.ruleDefinition.findFirst({ where: { key, effectiveFrom } });
    if (same) return this.prisma.ruleDefinition.update({ where: { id: same.id }, data: { value } });
    return this.prisma.ruleDefinition.create({ data: { key, value, effectiveFrom, description: latest?.description } });
  }
}
