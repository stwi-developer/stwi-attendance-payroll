import { BadRequestException, Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

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
  @Get('rules') rules() { return this.prisma.ruleDefinition.findMany({ where: { effectiveTo: null }, orderBy: { key: 'asc' } }); }
  @Patch('rules/:key') @Roles('CEO', 'HR') async updateRule(@Body() body: { value: string }, @Param('key') key: string) {
    const current = await this.prisma.ruleDefinition.findFirst({ where: { key, effectiveTo: null }, orderBy: { effectiveFrom: 'desc' } });
    if (current) await this.prisma.ruleDefinition.update({ where: { id: current.id }, data: { effectiveTo: new Date() } });
    return this.prisma.ruleDefinition.create({ data: { key, value: body.value, effectiveFrom: new Date(), description: current?.description } });
  }
}
