import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { codeKey } from '../utils/employee-code';
import { AuditService } from '../audit.service';
import { parsePagination, paged } from '../utils/pagination';
import { ALL_FIELDS, EmployeeFieldDef, MANUAL_FIELDS, PAYROLL_FIELDS, ZOHO_FIELDS, checkValue, isBlank, normalizeValue, toIsoDate } from './employee-fields';

type Tx = any;
type Input = Record<string, any>;

const EMPLOYEE_INCLUDE = {
  department: { include: { parent: { select: { id: true, name: true } } } },
  designation: true,
  salaryHistory: { orderBy: { effectiveFrom: 'desc' as const } },
  deposits: { include: { transactions: { orderBy: { transactionDate: 'asc' as const } } }, orderBy: { createdAt: 'desc' as const } },
};

/** Fields erased when an employee with payroll history is deleted (V1.9, STWI answer Q17 = B). */
const PERSONAL_FIELDS = ['dateOfBirth', 'gender', 'maritalStatus', 'personalMobile', 'personalEmail', 'permanentAddress', 'aadhaar', 'pan', 'bankAccountName', 'bankName', 'bankAccountNumber', 'bankIfsc', 'notes', 'totalExperience'];

const dateOrNull = (iso: string | null | undefined) => (iso ? new Date(`${iso}T00:00:00.000Z`) : null);
const isoOf = (d: Date | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : '');

export class FieldErrors extends BadRequestException {
  constructor(public readonly fieldErrors: Record<string, string>) {
    super({ statusCode: 400, message: Object.values(fieldErrors).join(' '), fieldErrors });
  }
}

@Injectable()
export class EmployeesService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  // ------------------------------------------------------------------ list / get
  async list(query: { page?: string; pageSize?: string; search?: string; status?: 'ACTIVE' | 'INACTIVE'; departmentId?: string; designationId?: string; minSalary?: string; maxSalary?: string }) {
    const { page, pageSize, skip } = parsePagination(query.page, query.pageSize);
    const search = query.search?.trim();
    const minSalary = query.minSalary === undefined || query.minSalary === '' ? undefined : Number(query.minSalary);
    const maxSalary = query.maxSalary === undefined || query.maxSalary === '' ? undefined : Number(query.maxSalary);
    const where: any = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(query.designationId ? { designationId: query.designationId } : {}),
      ...(search ? { OR: [{ employeeCode: { contains: search } }, { name: { contains: search } }, { email: { contains: search } }] } : {}),
    };
    const employees = await this.prisma.employee.findMany({
      where,
      include: { department: true, designation: true, salaryHistory: { orderBy: { effectiveFrom: 'desc' }, take: 1 } },
      orderBy: { name: 'asc' },
    });
    const filtered = employees.filter((e) => {
      const salary = Number(e.salaryHistory[0]?.grossSalary ?? 0);
      if (minSalary !== undefined && Number.isFinite(minSalary) && salary < minSalary) return false;
      if (maxSalary !== undefined && Number.isFinite(maxSalary) && salary > maxSalary) return false;
      return true;
    });
    return paged(filtered.slice(skip, skip + pageSize).map((e) => this.strip(e)), filtered.length, page, pageSize);
  }

  async get(id: string, role?: string) {
    const employee = await this.prisma.employee.findUnique({ where: { id }, include: EMPLOYEE_INCLUDE });
    if (!employee || employee.deletedAt) throw new NotFoundException('Employee not found');
    const full = { ...employee, depositHeld: await this.heldAmount(id) };
    // Junior HR sees the employee but not Aadhaar / PAN / bank account numbers
    return role === 'JUNIOR_HR' ? this.strip(full) : full;
  }

  /** Field definitions for the frontend forms (labels, required, Zoho hints). */
  fields() {
    const pick = (f: EmployeeFieldDef) => ({ key: f.key, label: f.label, kind: f.kind, required: f.required, choices: f.choices, zohoHeader: f.zohoHeader });
    return { zoho: ZOHO_FIELDS.map(pick), manual: MANUAL_FIELDS.map(pick), payroll: PAYROLL_FIELDS.map(pick) };
  }

  // ------------------------------------------------------------------ validation
  /**
   * Validates employee input. `partial` = only the fields present are checked
   * (editing); otherwise every required field must be there (creating).
   */
  validate(input: Input, opts: { partial: boolean; fields?: EmployeeFieldDef[] }) {
    const errors: Record<string, string> = {};
    const data: Record<string, any> = {};
    for (const def of opts.fields ?? ALL_FIELDS) {
      const present = Object.prototype.hasOwnProperty.call(input, def.key);
      if (opts.partial && !present) continue;
      const value = normalizeValue(def, input[def.key]);
      if (def.kind === 'date' && !isBlank(input[def.key]) && value === null) { errors[def.key] = `${def.label} is not a valid date.`; continue; }
      if (def.kind === 'bool' && value === undefined) { if (def.required && !opts.partial) errors[def.key] = `${def.label} is required.`; continue; }
      const err = checkValue(def, value);
      if (err) errors[def.key] = err;
      else data[def.key] = value;
    }
    return { data, errors };
  }

  /** Department / designation / employment type names -> ids (creates designations and employment types that come from Zoho). */
  private async resolveMasters(tx: Tx, data: Record<string, any>, opts: { createDepartments: boolean }) {
    const out: Record<string, any> = {};
    if (data.department !== undefined) {
      if (!data.department) out.departmentId = null;
      else {
        let dep = await tx.department.findUnique({ where: { name: data.department } });
        if (!dep && opts.createDepartments) dep = await tx.department.create({ data: { name: data.department } });
        if (!dep) throw new FieldErrors({ department: `Department "${data.department}" is not in the list.` });
        if (!dep.active) await tx.department.update({ where: { id: dep.id }, data: { active: true } });
        out.departmentId = dep.id;
      }
    }
    if (data.designation !== undefined) {
      if (!data.designation) out.designationId = null;
      else out.designationId = (await tx.designation.upsert({ where: { name: data.designation }, update: { active: true }, create: { name: data.designation } })).id;
    }
    if (data.employmentType !== undefined) {
      out.employmentType = data.employmentType || null;
      if (data.employmentType) await tx.employmentType.upsert({ where: { name: data.employmentType }, update: { active: true }, create: { name: data.employmentType } });
    }
    return out;
  }

  /** Maps validated data to Employee columns (not salary / deposit). */
  private employeeColumns(data: Record<string, any>) {
    const cols: Record<string, any> = {};
    const text = ['firstName', 'lastName', 'totalExperience', 'gender', 'maritalStatus', 'personalMobile', 'personalEmail', 'permanentAddress', 'aadhaar', 'pan', 'bankAccountName', 'bankName', 'bankAccountNumber', 'bankIfsc', 'notes', 'email'];
    for (const k of text) if (data[k] !== undefined) cols[k] = data[k];
    if (data.joiningDate !== undefined) cols.joiningDate = dateOrNull(data.joiningDate);
    if (data.dateOfBirth !== undefined) cols.dateOfBirth = dateOrNull(data.dateOfBirth);
    if (data.professionalTaxApplicable !== undefined) cols.professionalTaxApplicable = !!data.professionalTaxApplicable;
    return cols;
  }

  // ------------------------------------------------------------------ create
  async create(input: Input, userId?: string) {
    const { data, errors } = this.validate(input, { partial: false });
    if (Object.keys(errors).length) throw new FieldErrors(errors);
    const result = await this.prisma.$transaction((tx) => this.createInTx(tx, data, { createDepartments: false }));
    await this.audit.log({ userId, action: 'CREATE', entityType: 'Employee', entityId: result.id, employeeId: result.id, afterJson: this.forAudit(result) });
    return result;
  }

  /** Creates the employee, first salary row and the deposit already taken. Used by manual entry and the Zoho import. */
  async createInTx(tx: Tx, data: Record<string, any>, opts: { createDepartments: boolean }) {
    const employeeCode = String(data.employeeCode).trim();
    // 2026/SEP/06, 2026/sep/06 and 2026-sep-06 count as the same ID
    const existing = (await tx.employee.findMany({ select: { employeeCode: true, name: true, deletedAt: true } })).find((e: any) => codeKey(e.employeeCode) === codeKey(employeeCode));
    if (existing) {
      throw new FieldErrors({ employeeCode: existing.deletedAt ? `Employee ID ${employeeCode} belonged to ${existing.name}, who was deleted. Use another ID.` : `Employee ID ${employeeCode} already exists (${existing.name}).` });
    }
    const grossSalary = Number(data.grossSalary);
    const initialDeposit = Number(data.securityDepositAlreadyTaken ?? 0);
    if (initialDeposit > grossSalary) throw new FieldErrors({ securityDepositAlreadyTaken: 'Security deposit already taken cannot be more than the gross salary.' });

    const masters = await this.resolveMasters(tx, data, opts);
    const employee = await tx.employee.create({
      data: {
        employeeCode,
        name: `${data.firstName} ${data.lastName}`.trim(),
        ...this.employeeColumns(data),
        ...masters,
      },
    });
    const effectiveFrom = dateOrNull(data.salaryEffectiveFrom || data.joiningDate) ?? new Date();
    await tx.employeeSalary.create({ data: { employeeId: employee.id, effectiveFrom, grossSalary } });
    if (initialDeposit > 0) {
      const additionalRequired = Math.max(0, grossSalary - initialDeposit);
      await tx.securityDeposit.create({
        data: {
          payrollRunId: null, employeeId: employee.id, triggerReason: 'INITIAL_DEPOSIT_ALREADY_TAKEN',
          previousSalary: 0, currentSalary: grossSalary, requiredDeposit: grossSalary, alreadyHeld: initialDeposit, additionalRequired,
          method: 'FULL', installmentCount: additionalRequired > 0 ? 1 : 0, installmentAmount: additionalRequired, status: 'ACTIVE',
        },
      });
    }
    return tx.employee.findUnique({ where: { id: employee.id }, include: EMPLOYEE_INCLUDE });
  }

  // ------------------------------------------------------------------ update
  async update(id: string, input: Input, userId?: string) {
    const existing = await this.prisma.employee.findUnique({ where: { id }, include: { salaryHistory: { orderBy: { effectiveFrom: 'desc' }, take: 1 } } });
    if (!existing || existing.deletedAt) throw new NotFoundException('Employee not found');
    // Employee ID is fixed: attendance files are matched by it. Salary has its own endpoints.
    const fields = ALL_FIELDS.filter((f) => !['employeeCode', 'grossSalary', 'salaryEffectiveFrom', 'securityDepositAlreadyTaken'].includes(f.key));
    const { data, errors } = this.validate(input, { partial: true, fields });
    if (Object.keys(errors).length) throw new FieldErrors(errors);

    const result = await this.prisma.$transaction(async (tx) => {
      const masters = await this.resolveMasters(tx, data, { createDepartments: false });
      const cols = this.employeeColumns(data);
      const firstName = data.firstName ?? existing.firstName;
      const lastName = data.lastName ?? existing.lastName;
      if (data.firstName !== undefined || data.lastName !== undefined) cols.name = `${firstName ?? ''} ${lastName ?? ''}`.trim();
      await tx.employee.update({ where: { id }, data: { ...cols, ...masters } });
      // kept for older screens: a salary sent with the employee creates a salary row
      if (input.grossSalary !== undefined && input.grossSalary !== '' && Number(input.grossSalary) !== Number(existing.salaryHistory[0]?.grossSalary)) {
        await this.addSalaryInTx(tx, id, { grossSalary: input.grossSalary, effectiveFrom: input.salaryEffectiveFrom, notes: undefined }, existing.salaryHistory[0] ? Number(existing.salaryHistory[0].grossSalary) : undefined);
      }
      return tx.employee.findUnique({ where: { id }, include: EMPLOYEE_INCLUDE });
    });
    await this.audit.log({ userId, action: 'UPDATE', entityType: 'Employee', entityId: id, employeeId: id, beforeJson: this.forAudit(existing), afterJson: this.forAudit(result) });
    return result;
  }

  // ------------------------------------------------------------------ salary history
  private parseSalary(body: Input) {
    const grossSalary = Number(body?.grossSalary);
    const effectiveFrom = toIsoDate(body?.effectiveFrom);
    const errors: Record<string, string> = {};
    if (isBlank(body?.grossSalary) || !Number.isFinite(grossSalary) || grossSalary < 0) errors.grossSalary = 'Gross salary must be a valid amount (0 or more).';
    if (!effectiveFrom) errors.effectiveFrom = 'Effective From must be a valid date.';
    if (Object.keys(errors).length) throw new FieldErrors(errors);
    const notes = isBlank(body?.notes) ? null : String(body.notes).trim();
    return { grossSalary, effectiveFrom: effectiveFrom!, notes };
  }

  private async addSalaryInTx(tx: Tx, employeeId: string, body: Input, previous?: number) {
    const s = this.parseSalary({ ...body, effectiveFrom: body.effectiveFrom ?? new Date().toISOString().slice(0, 10) });
    const auto = previous !== undefined ? `Salary changed from ${previous} to ${s.grossSalary}` : null;
    return tx.employeeSalary.create({ data: { employeeId, effectiveFrom: dateOrNull(s.effectiveFrom)!, grossSalary: s.grossSalary, notes: [s.notes, auto].filter(Boolean).join(' · ') || null } });
  }

  async addSalary(id: string, body: Input, userId?: string) {
    const emp = await this.prisma.employee.findUnique({ where: { id }, include: { salaryHistory: { orderBy: { effectiveFrom: 'desc' }, take: 1 } } });
    if (!emp || emp.deletedAt) throw new NotFoundException('Employee not found');
    const row = await this.prisma.$transaction((tx) => this.addSalaryInTx(tx, id, body, emp.salaryHistory[0] ? Number(emp.salaryHistory[0].grossSalary) : undefined));
    await this.audit.log({ userId, action: 'SALARY_ADD', entityType: 'EmployeeSalary', entityId: row.id, employeeId: id, afterJson: row });
    return this.get(id);
  }

  async updateSalary(id: string, salaryId: string, body: Input, userId?: string) {
    const row = await this.prisma.employeeSalary.findUnique({ where: { id: salaryId } });
    if (!row || row.employeeId !== id) throw new NotFoundException('Salary row not found');
    const s = this.parseSalary(body);
    const updated = await this.prisma.employeeSalary.update({ where: { id: salaryId }, data: { grossSalary: s.grossSalary, effectiveFrom: dateOrNull(s.effectiveFrom)!, notes: s.notes } });
    await this.audit.log({ userId, action: 'SALARY_UPDATE', entityType: 'EmployeeSalary', entityId: salaryId, employeeId: id, beforeJson: row, afterJson: updated });
    return this.get(id);
  }

  async deleteSalary(id: string, salaryId: string, userId?: string) {
    const row = await this.prisma.employeeSalary.findUnique({ where: { id: salaryId } });
    if (!row || row.employeeId !== id) throw new NotFoundException('Salary row not found');
    const count = await this.prisma.employeeSalary.count({ where: { employeeId: id } });
    if (count <= 1) throw new BadRequestException('This is the only salary row. Edit it instead of deleting it.');
    await this.prisma.employeeSalary.delete({ where: { id: salaryId } });
    await this.audit.log({ userId, action: 'SALARY_DELETE', entityType: 'EmployeeSalary', entityId: salaryId, employeeId: id, beforeJson: row });
    return this.get(id);
  }

  // ------------------------------------------------------------------ deactivate / reactivate
  async deactivate(id: string, body: Input, userId?: string) {
    const emp = await this.prisma.employee.findUnique({ where: { id } });
    if (!emp || emp.deletedAt) throw new NotFoundException('Employee not found');
    const dateOfExit = toIsoDate(body?.dateOfExit);
    if (!dateOfExit) throw new FieldErrors({ dateOfExit: 'Date of Exit is required.' });
    if (emp.joiningDate && dateOfExit < isoOf(emp.joiningDate)) throw new FieldErrors({ dateOfExit: 'Date of Exit cannot be before the joining date.' });
    await this.prisma.employee.update({ where: { id }, data: { status: 'INACTIVE', dateOfExit: dateOrNull(dateOfExit) } });
    await this.audit.log({ userId, action: 'DEACTIVATE', entityType: 'Employee', entityId: id, employeeId: id, beforeJson: { status: emp.status, dateOfExit: emp.dateOfExit }, afterJson: { status: 'INACTIVE', dateOfExit } });
    return this.get(id);
  }

  async reactivate(id: string, userId?: string) {
    const emp = await this.prisma.employee.findUnique({ where: { id } });
    if (!emp || emp.deletedAt) throw new NotFoundException('Employee not found');
    await this.prisma.employee.update({ where: { id }, data: { status: 'ACTIVE', dateOfExit: null } });
    await this.audit.log({ userId, action: 'REACTIVATE', entityType: 'Employee', entityId: id, employeeId: id, beforeJson: { status: emp.status, dateOfExit: emp.dateOfExit }, afterJson: { status: 'ACTIVE' } });
    return this.get(id);
  }

  // ------------------------------------------------------------------ export + delete (danger zone)
  async exportWorkbook(id: string, userId?: string) {
    const emp = await this.get(id);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'STWI Attendance & Payroll';
    const head = (ws: ExcelJS.Worksheet) => {
      const r = ws.getRow(1);
      r.font = { bold: true, color: { argb: 'FF25387C' } };
      r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFBC116' } };
      ws.views = [{ state: 'frozen', ySplit: 1 }];
    };

    const profile = wb.addWorksheet('Profile');
    profile.columns = [{ header: 'Field', width: 34 }, { header: 'Value', width: 50 }];
    const value = (k: string): any => {
      const v: any = (emp as any)[k];
      if (k === 'department') return emp.department?.name ?? '';
      if (k === 'designation') return emp.designation?.name ?? '';
      if (v instanceof Date) return isoOf(v);
      if (typeof v === 'boolean') return v ? 'Yes' : 'No';
      return v ?? '';
    };
    for (const f of [...ZOHO_FIELDS, ...MANUAL_FIELDS]) profile.addRow([f.label, value(f.key)]);
    for (const f of PAYROLL_FIELDS.filter((x) => !['grossSalary', 'salaryEffectiveFrom', 'securityDepositAlreadyTaken'].includes(x.key))) profile.addRow([f.label, value(f.key)]);
    profile.addRow(['Status', emp.status]);
    profile.addRow(['Date of Exit', isoOf(emp.dateOfExit)]);
    profile.addRow(['Current Gross Salary', Number(emp.salaryHistory[0]?.grossSalary ?? 0)]);
    profile.addRow(['Security Deposit Held', emp.depositHeld]);
    profile.addRow(['Exported on', new Date().toISOString().slice(0, 19).replace('T', ' ')]);
    head(profile);

    const sal = wb.addWorksheet('Salary History');
    sal.columns = [{ header: 'Effective From', width: 16 }, { header: 'Gross Salary', width: 16 }, { header: 'Notes', width: 60 }];
    for (const s of [...emp.salaryHistory].reverse()) sal.addRow([isoOf(s.effectiveFrom), Number(s.grossSalary), s.notes ?? '']);
    head(sal);

    const dep = wb.addWorksheet('Security Deposit');
    dep.columns = [{ header: 'Date', width: 14 }, { header: 'Type', width: 26 }, { header: 'Amount', width: 14 }, { header: 'Required', width: 14 }, { header: 'Held before', width: 14 }, { header: 'Method', width: 14 }, { header: 'Status', width: 12 }];
    for (const d of [...emp.deposits].reverse()) {
      dep.addRow([isoOf(d.createdAt), d.triggerReason, Number(d.additionalRequired), Number(d.requiredDeposit), Number(d.alreadyHeld), d.method, d.status]);
      for (const t of d.transactions) dep.addRow([isoOf(t.transactionDate), `  Installment ${t.installmentNumber}${t.note ? ` (${t.note})` : ''}`, Number(t.amount), '', '', '', '']);
    }
    head(dep);

    const payrolls = await this.prisma.payrollResult.findMany({ where: { employeeId: id }, include: { payrollRun: true } });
    payrolls.sort((a, b) => a.payrollRun.year - b.payrollRun.year || a.payrollRun.month - b.payrollRun.month);
    const pay = wb.addWorksheet('Payroll');
    pay.columns = ['Month', 'Run Status', 'Gross', 'Leave Days', 'Late Marks', 'Deduction Leave', 'Penalty', 'Security Deposit', 'P.Tax', 'Other Deductions', 'Payable'].map((h) => ({ header: h, width: 15 }));
    for (const p of payrolls) {
      pay.addRow([`${p.payrollRun.year}-${String(p.payrollRun.month).padStart(2, '0')}`, p.payrollRun.status, Number(p.grossSalary), Number(p.stwiLeaveDays), p.lateMarks,
        Number(p.lateLeaveDeduction) + Number(p.excessLeaveDeduction) + Number(p.doubleDeductionLeave), Number(p.penalty), Number(p.securityDeposit), Number(p.ptax), Number(p.otherDeductions), Number(p.payableAmount)]);
    }
    head(pay);

    const att = await this.prisma.attendanceRecord.findMany({ where: { employeeId: id }, orderBy: { workDate: 'asc' } });
    const aws = wb.addWorksheet('Attendance');
    aws.columns = ['Date', 'Zoho Status', 'System Status', 'First Check-in', 'Hours', 'Late', 'Late (min)', 'Leave'].map((h) => ({ header: h, width: 16 }));
    for (const a of att) aws.addRow([isoOf(a.workDate), a.sourceStatus ?? '', a.status, a.firstCheckIn ? new Date(a.firstCheckIn).toISOString().slice(11, 16) : '', a.workedHours == null ? '' : Number(a.workedHours), a.isLate ? 'Yes' : 'No', a.lateMinutes ?? '', Number(a.leaveFraction ?? 0)]);
    head(aws);

    await this.audit.log({ userId, action: 'EXPORT', entityType: 'Employee', entityId: id, employeeId: id });
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const safe = `${emp.employeeCode}_${emp.name}`.replace(/[^A-Za-z0-9._-]+/g, '_');
    return { buffer, fileName: `Employee_${safe}.xlsx` };
  }

  async remove(userId: string, id: string, body: Input) {
    const employee = await this.prisma.employee.findUnique({
      where: { id },
      include: { salaryHistory: true, attendance: { take: 1 }, payrolls: { take: 1 }, reviews: { take: 1 }, deposits: { take: 1 } },
    });
    if (!employee || employee.deletedAt) throw new NotFoundException('Employee not found');
    if (employee.status !== 'INACTIVE') throw new BadRequestException('Deactivate the employee before deleting.');
    if (String(body?.confirmCode ?? '').trim() !== employee.employeeCode) throw new BadRequestException(`Type the Employee ID ${employee.employeeCode} to confirm.`);
    const exported = await this.prisma.auditLog.findFirst({ where: { employeeId: id, action: 'EXPORT', createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } } });
    if (!exported) throw new BadRequestException('Export the employee information first (within the last 24 hours).');

    const hasHistory = employee.attendance.length || employee.payrolls.length || employee.reviews.length || employee.deposits.length;
    if (!hasHistory) {
      await this.prisma.employee.delete({ where: { id } });
      await this.audit.log({ userId, action: 'DELETE', entityType: 'Employee', entityId: id, beforeJson: { employeeCode: employee.employeeCode, name: employee.name } });
      return { deleted: true, id, keptHistory: false };
    }
    const erase: Record<string, null> = {};
    for (const k of PERSONAL_FIELDS) erase[k] = null;
    await this.prisma.$transaction([
      this.prisma.employee.update({ where: { id }, data: { ...erase, deletedAt: new Date(), deletedById: userId } }),
      // the same personal details can also sit in Zoho imports and in audit copies
      this.prisma.employeeImportRow.updateMany({ where: { OR: [{ employeeId: id }, { employeeCode: employee.employeeCode }] }, data: { manualJson: Prisma.DbNull } }),
      this.prisma.auditLog.updateMany({ where: { employeeId: id, entityType: { in: ['Employee', 'EmployeeImportBatch'] } }, data: { beforeJson: Prisma.DbNull, afterJson: Prisma.DbNull } }),
    ]);
    await this.audit.log({ userId, action: 'DELETE', entityType: 'Employee', entityId: id, employeeId: id, beforeJson: { employeeCode: employee.employeeCode, name: employee.name }, afterJson: { personalDataErased: true, payrollHistoryKept: true } });
    return { deleted: true, id, keptHistory: true };
  }

  // ------------------------------------------------------------------ helpers
  /** Security deposit currently held = held before the latest deposit plan + what that plan has collected. */
  async heldAmount(employeeId: string) {
    const latest = await this.prisma.securityDeposit.findFirst({ where: { employeeId }, orderBy: { createdAt: 'desc' }, include: { transactions: true } });
    if (!latest) return 0;
    const collected = latest.transactions.reduce((s, t) => s + Number(t.amount), 0);
    return Math.round((Number(latest.alreadyHeld) + collected) * 100) / 100;
  }

  /** Copy with Aadhaar / PAN / bank account masked (list screens, Junior HR). */
  private strip(e: any) {
    if (!e) return e;
    const { aadhaar, pan, bankAccountNumber, ...rest } = e;
    return { ...rest, aadhaar: aadhaar ? `********${String(aadhaar).slice(-4)}` : aadhaar, pan: pan ? `******${String(pan).slice(-4)}` : pan, bankAccountNumber: bankAccountNumber ? `****${String(bankAccountNumber).slice(-4)}` : bankAccountNumber };
  }

  /** Audit-log copy: personal details are left out completely. */
  private forAudit(e: any) {
    if (!e) return e;
    const out = { ...this.strip(e) };
    for (const k of ['personalMobile', 'personalEmail', 'permanentAddress', 'dateOfBirth', 'bankAccountName', 'bankName', 'bankIfsc', 'aadhaar', 'pan', 'bankAccountNumber']) if (out[k]) out[k] = '(hidden)';
    return out;
  }
}
