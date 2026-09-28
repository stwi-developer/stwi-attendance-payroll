import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { PrismaService } from '../prisma.service';
import { codeKey } from '../utils/employee-code';
import { AuditService } from '../audit.service';
import { EmployeesService, FieldErrors } from './employees.service';
import { EmployeeFieldDef, MANUAL_FIELDS, PAYROLL_FIELDS, ZOHO_FIELDS, checkValue, columnLetter, isBlank, normalizeValue } from './employee-fields';

// V1.9: import of the Zoho People "Employee View" export.
//
// Upload -> every row is kept in the database (EmployeeImportRow) with a status:
//   PROBLEM        a yellow (Zoho) value is missing or wrong -> fix in Zoho, export again, re-upload
//   NEEDS_DETAILS  Zoho data is fine; green fields / salary / bank still to fill in the app
//   READY          everything filled; can be created
//   CREATED        employee created
//   CHANGED        employee already exists and Zoho has different values -> Apply or Skip
//   UNCHANGED      employee already exists, nothing changed in Zoho
//   UPDATED / SKIPPED  decision taken for a CHANGED row
//   NOT_ACTIVE     not "Active" in Zoho and not in the app -> ignored
// Re-uploading keeps what was already typed for each Employee ID.

const OPEN_STATUSES = ['PROBLEM', 'NEEDS_DETAILS', 'READY', 'CHANGED'];
const DETAIL_FIELDS = [...MANUAL_FIELDS, ...PAYROLL_FIELDS];

type Problem = { field: string; label: string; message: string; cell?: string };
type Diff = { field: string; label: string; from: string; to: string };

@Injectable()
export class EmployeeImportService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly employees: EmployeesService) {}

  // ------------------------------------------------------------------ upload
  async upload(userId: string, file?: Express.Multer.File) {
    if (!file?.buffer?.length) throw new BadRequestException('Choose the Employee View file exported from Zoho People.');
    let rows: any[][];
    try {
      const wb = XLSX.read(file.buffer, { type: 'buffer', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' }) as any[][];
    } catch {
      throw new BadRequestException('The file could not be read. Upload the .xls/.xlsx exported from Zoho People > Employee View.');
    }

    // header row = the first row that has "Employee ID" and "First Name"
    const headerIndex = rows.findIndex((r) => r.some((c) => norm(c) === 'employee id') && r.some((c) => norm(c) === 'first name'));
    if (headerIndex < 0) throw new BadRequestException('This is not a Zoho Employee View export: the "Employee ID" and "First Name" columns were not found.');
    const header = rows[headerIndex].map(norm);
    const col = (h?: string) => (h ? header.indexOf(norm(h)) : -1);
    const missingColumns = [...ZOHO_FIELDS].filter((f) => col(f.zohoHeader) < 0).map((f) => f.zohoHeader);
    if (missingColumns.length) throw new BadRequestException(`These Zoho columns are missing from the file: ${missingColumns.join(', ')}. Export the full Employee View from Zoho People.`);
    const statusCol = col('Employee Status');

    // what was typed in earlier, unfinished imports (kept per Employee ID)
    const openBatches = await this.prisma.employeeImportBatch.findMany({ where: { status: 'OPEN' }, include: { rows: true }, orderBy: { createdAt: 'asc' } });
    const carried = new Map<string, any>();
    const filledCount = (m: any) => Object.values(m ?? {}).filter((v) => v !== '' && v !== null && v !== undefined).length;
    for (const b of openBatches) for (const r of b.rows) {
      if (!r.manualJson || r.status === 'CREATED') continue;
      // the same ID can be in a file twice (duplicate row): keep the fuller set of details
      const k = codeKey(r.employeeCode);
      if (!carried.has(k) || filledCount(r.manualJson) >= filledCount(carried.get(k))) carried.set(k, r.manualJson);
    }

    const existingEmployees = await this.prisma.employee.findMany({ include: { department: true, designation: true } });
    const byCode = new Map(existingEmployees.map((e) => [codeKey(e.employeeCode), e]));

    const seen = new Map<string, number>();
    const staged: any[] = [];
    for (let i = headerIndex + 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r.every((c) => isBlank(c))) continue;
      const excelRow = i + 1;
      const values: Record<string, any> = {};
      const cells: Record<string, string> = {};
      const problems: Problem[] = [];
      for (const f of ZOHO_FIELDS) {
        const c = col(f.zohoHeader);
        cells[f.key] = `${columnLetter(c)}${excelRow}`;
        const raw = r[c];
        const v = normalizeValue(f, raw);
        if (f.kind === 'date' && !isBlank(raw) && v === null) { problems.push(problem(f, `${f.label} "${raw}" is not a valid date.`, cells[f.key])); continue; }
        const err = checkValue(f, v);
        if (err) problems.push(problem(f, isBlank(v) ? `${f.label} is empty in Zoho.` : err, cells[f.key]));
        values[f.key] = v;
      }
      const code = String(values.employeeCode ?? '').trim();
      if (!code) continue; // no ID -> not an employee row
      const key = codeKey(code);
      if (seen.has(key)) problems.push({ field: 'employeeCode', label: 'Employee ID', message: `Employee ID ${code} is also on Excel row ${seen.get(key)}.`, cell: cells.employeeCode });
      seen.set(key, excelRow);

      // green fields that Zoho already has are pre-filled (STWI answer Q1 = B)
      const prefill: Record<string, any> = {};
      for (const f of MANUAL_FIELDS) {
        const c = col(f.zohoHeader);
        if (c >= 0 && !isBlank(r[c])) prefill[f.key] = normalizeValue(f, r[c]);
      }
      const zohoStatus = statusCol >= 0 ? String(r[statusCol] ?? '').trim() : '';
      const existing = byCode.get(key);

      let action = 'NEW';
      let status: string;
      let diffs: Diff[] = [];
      let manual: Record<string, any> | null = null;
      if (existing) {
        action = 'EXISTING';
        if (existing.deletedAt) {
          problems.push({ field: 'employeeCode', label: 'Employee ID', message: `Employee ID ${code} belonged to ${existing.name}, who was deleted in the app. Give this person a new ID in Zoho.`, cell: cells.employeeCode });
          status = 'PROBLEM';
        } else {
          diffs = this.diff(existing, values);
          status = diffs.length ? 'CHANGED' : 'UNCHANGED';
        }
      } else if (zohoStatus && zohoStatus.toLowerCase() !== 'active') {
        status = 'NOT_ACTIVE';
      } else {
        const filled: Record<string, any> = { ...defaults(values), ...prefill, ...(carried.get(key) ?? {}) };
        manual = filled;
        status = problems.length ? 'PROBLEM' : this.detailErrors(filled).length ? 'NEEDS_DETAILS' : 'READY';
      }
      staged.push({ rowNumber: excelRow, employeeCode: code, action, status, zohoJson: { values, cells, zohoStatus }, manualJson: manual, problemsJson: problems.length ? problems : null, diffJson: diffs.length ? diffs : null, employeeId: existing?.id ?? null });
    }
    if (!staged.length) throw new BadRequestException('No employees were found in the file.');

    const inFile = new Set(staged.map((s) => codeKey(s.employeeCode)));
    const missing = existingEmployees.filter((e) => !e.deletedAt && e.status === 'ACTIVE' && !inFile.has(codeKey(e.employeeCode))).map((e) => ({ id: e.id, employeeCode: e.employeeCode, name: e.name }));

    const batch = await this.prisma.$transaction(async (tx) => {
      if (openBatches.length) await tx.employeeImportBatch.updateMany({ where: { id: { in: openBatches.map((b) => b.id) } }, data: { status: 'REPLACED' } });
      return tx.employeeImportBatch.create({ data: { fileName: file.originalname, createdById: userId, missingJson: missing, rows: { create: staged } } });
    });
    await this.audit.log({ userId, action: 'IMPORT_UPLOAD', entityType: 'EmployeeImportBatch', entityId: batch.id, afterJson: { fileName: file.originalname, rows: staged.length } });
    return this.get(batch.id);
  }

  // ------------------------------------------------------------------ read
  async current() {
    const batch = await this.prisma.employeeImportBatch.findFirst({ where: { status: 'OPEN' }, orderBy: { createdAt: 'desc' } });
    return batch ? this.get(batch.id) : null;
  }

  async get(id: string) {
    const batch = await this.prisma.employeeImportBatch.findUnique({ where: { id }, include: { rows: { orderBy: { rowNumber: 'asc' } } } });
    if (!batch) throw new NotFoundException('Import not found');
    const rows = batch.rows.map((r) => ({ ...r, missingCount: r.manualJson && ['NEEDS_DETAILS', 'READY'].includes(r.status) ? this.detailErrors(r.manualJson as any).length : 0 }));
    const count = (s: string) => rows.filter((r) => r.status === s).length;
    return {
      ...batch,
      rows,
      summary: {
        total: rows.length, problems: count('PROBLEM'), needsDetails: count('NEEDS_DETAILS'), ready: count('READY'), created: count('CREATED'),
        changed: count('CHANGED'), unchanged: count('UNCHANGED'), updated: count('UPDATED'), skipped: count('SKIPPED'), notActive: count('NOT_ACTIVE'),
        existing: rows.filter((r) => r.action === 'EXISTING').length,
      },
    };
  }

  // ------------------------------------------------------------------ fill in details
  async saveDetails(userId: string, batchId: string, rowId: string, body: any) {
    const row = await this.openRow(batchId, rowId);
    if (!['NEEDS_DETAILS', 'READY', 'PROBLEM'].includes(row.status) || row.action !== 'NEW') throw new BadRequestException('Details can only be filled for new employees that are not created yet.');
    const current = (row.manualJson as any) ?? {};
    const next: Record<string, any> = { ...current };
    for (const f of DETAIL_FIELDS) if (body && Object.prototype.hasOwnProperty.call(body, f.key)) next[f.key] = normalizeValue(f, body[f.key]) ?? '';
    const errors = this.detailErrors(next);
    const status = row.problemsJson ? 'PROBLEM' : errors.length ? 'NEEDS_DETAILS' : 'READY';
    await this.prisma.employeeImportRow.update({ where: { id: rowId }, data: { manualJson: next, status } });
    const updated = await this.get(batchId);
    return { batch: updated, fieldErrors: Object.fromEntries(errors.map((e) => [e.field, e.message])) };
  }

  // ------------------------------------------------------------------ create
  async create(userId: string, batchId: string, body: { rowIds?: string[] }) {
    const batch = await this.get(batchId);
    if (batch.status !== 'OPEN') throw new BadRequestException('This import is closed.');
    const wanted = body?.rowIds?.length ? new Set(body.rowIds) : null;
    const rows = batch.rows.filter((r) => r.status === 'READY' && (!wanted || wanted.has(r.id)));
    if (!rows.length) throw new BadRequestException('No employees are ready. Fill in the missing details first.');
    const created: string[] = [];
    const failed: { employeeCode: string; message: string }[] = [];
    for (const r of rows) {
      const data = { ...(r.zohoJson as any).values, ...(r.manualJson as any) };
      const { data: clean, errors } = this.employees.validate(data, { partial: false });
      if (Object.keys(errors).length) { failed.push({ employeeCode: r.employeeCode, message: Object.values(errors).join(' ') }); continue; }
      try {
        const emp = await this.prisma.$transaction((tx) => this.employees.createInTx(tx, clean, { createDepartments: true }));
        await this.prisma.employeeImportRow.update({ where: { id: r.id }, data: { status: 'CREATED', employeeId: emp.id } });
        await this.audit.log({ userId, action: 'CREATE', entityType: 'Employee', entityId: emp.id, employeeId: emp.id, afterJson: { source: 'Zoho import', batchId, employeeCode: emp.employeeCode, name: emp.name } });
        created.push(r.employeeCode);
      } catch (e: any) {
        failed.push({ employeeCode: r.employeeCode, message: e instanceof FieldErrors ? Object.values(e.fieldErrors).join(' ') : e?.message ?? String(e) });
      }
    }
    await this.closeIfDone(batchId);
    return { created, failed, batch: await this.get(batchId) };
  }

  // ------------------------------------------------------------------ existing employees
  async apply(userId: string, batchId: string, rowId: string) {
    const row = await this.openRow(batchId, rowId);
    if (row.status !== 'CHANGED' || !row.employeeId) throw new BadRequestException('Nothing to apply for this row.');
    const values = (row.zohoJson as any).values;
    const diffs = (row.diffJson as any as Diff[]) ?? [];
    const patch: Record<string, any> = {};
    for (const d of diffs) patch[d.field] = values[d.field];
    await this.employees.update(row.employeeId, patch, userId).catch(async (e) => {
      // a department that is new in Zoho is added to the list first
      if (e instanceof FieldErrors && e.fieldErrors.department && patch.department) {
        await this.prisma.department.upsert({ where: { name: patch.department }, update: { active: true }, create: { name: patch.department } });
        return this.employees.update(row.employeeId!, patch, userId);
      }
      throw e;
    });
    await this.prisma.employeeImportRow.update({ where: { id: rowId }, data: { status: 'UPDATED' } });
    await this.closeIfDone(batchId);
    return this.get(batchId);
  }

  async skip(batchId: string, rowId: string) {
    const row = await this.openRow(batchId, rowId);
    if (!OPEN_STATUSES.includes(row.status)) throw new BadRequestException('This row is already done.');
    await this.prisma.employeeImportRow.update({ where: { id: rowId }, data: { status: 'SKIPPED' } });
    await this.closeIfDone(batchId);
    return this.get(batchId);
  }

  async cancel(userId: string, batchId: string) {
    const batch = await this.prisma.employeeImportBatch.findUnique({ where: { id: batchId } });
    if (!batch) throw new NotFoundException('Import not found');
    await this.prisma.employeeImportBatch.update({ where: { id: batchId }, data: { status: 'CANCELLED' } });
    await this.audit.log({ userId, action: 'IMPORT_CANCEL', entityType: 'EmployeeImportBatch', entityId: batchId });
    return { cancelled: true };
  }

  // ------------------------------------------------------------------ helpers
  private async openRow(batchId: string, rowId: string) {
    const row = await this.prisma.employeeImportRow.findUnique({ where: { id: rowId }, include: { batch: true } });
    if (!row || row.batchId !== batchId) throw new NotFoundException('Import row not found');
    if (row.batch.status !== 'OPEN') throw new BadRequestException('This import is closed. Upload the file again.');
    return row;
  }

  private async closeIfDone(batchId: string) {
    const open = await this.prisma.employeeImportRow.count({ where: { batchId, status: { in: OPEN_STATUSES } } });
    if (!open) await this.prisma.employeeImportBatch.update({ where: { id: batchId }, data: { status: 'COMPLETED' } });
  }

  private detailErrors(manual: Record<string, any>) {
    const out: { field: string; message: string }[] = [];
    for (const f of DETAIL_FIELDS) {
      const v = f.kind === 'money' && !isBlank(manual[f.key]) ? Number(manual[f.key]) : manual[f.key];
      if (f.kind === 'bool') { if (v === undefined || v === null || v === '') out.push({ field: f.key, message: `${f.label} is required.` }); continue; }
      const err = checkValue(f, isBlank(v) ? null : v);
      if (err) out.push({ field: f.key, message: err });
    }
    const gross = Number(manual.grossSalary), dep = Number(manual.securityDepositAlreadyTaken);
    if (Number.isFinite(gross) && Number.isFinite(dep) && dep > gross) out.push({ field: 'securityDepositAlreadyTaken', message: 'Security deposit already taken cannot be more than the gross salary.' });
    return out;
  }

  /** Yellow fields where Zoho differs from the app (blank Zoho values are not treated as changes). */
  private diff(e: any, v: Record<string, any>): Diff[] {
    const iso = (d: any) => (d ? new Date(d).toISOString().slice(0, 10) : '');
    const current: Record<string, string> = {
      firstName: e.firstName ?? '', lastName: e.lastName ?? '', email: e.email ?? '', department: e.department?.name ?? '', designation: e.designation?.name ?? '',
      employmentType: e.employmentType ?? '', joiningDate: iso(e.joiningDate), totalExperience: e.totalExperience ?? '', dateOfBirth: iso(e.dateOfBirth), gender: e.gender ?? '', maritalStatus: e.maritalStatus ?? '',
    };
    const out: Diff[] = [];
    for (const f of ZOHO_FIELDS) {
      if (f.key === 'employeeCode' || isBlank(v[f.key])) continue;
      const to = String(v[f.key]);
      const from = current[f.key] ?? '';
      if (f.key === 'email' ? from.toLowerCase() !== to.toLowerCase() : from !== to) out.push({ field: f.key, label: f.label, from: from || '—', to });
    }
    return out;
  }
}

function norm(v: unknown) { return String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' '); }

function problem(f: EmployeeFieldDef, message: string, cell: string): Problem {
  return { field: f.key, label: f.label, message: `${message} Fix it in Zoho People (${f.zohoHint}) or in cell ${cell} of the Excel file, then upload the file again.`, cell };
}

/** Starting values for the "fill in" form. */
function defaults(values: Record<string, any>) {
  return { salaryEffectiveFrom: values.joiningDate ?? '', professionalTaxApplicable: true, securityDepositAlreadyTaken: 0 };
}
