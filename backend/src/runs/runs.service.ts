import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit.service';
import { SecurityDepositService } from '../security-deposit.service';
import { parseBoolean, parsePagination, paged } from '../utils/pagination';

const money = (n: number) => Math.round(n * 100) / 100;
const hoursToLeaveFraction = (requiredHours: number, workedHours: number) =>
  money(Math.max(0, (requiredHours - workedHours) / 8));
const dayMs = 86400000;

function asDate(value: any): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H || 0, parsed.M || 0, parsed.S || 0));
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Date-only values from Zoho such as "06-Aug-2026" must be parsed
// without the machine's local timezone. Otherwise midnight can become
// the previous UTC date (e.g. 06-Aug becoming 05-Aug).
function asAttendanceDate(value: any): Date | null {
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(Date.UTC(
      value.getUTCFullYear(),
      value.getUTCMonth(),
      value.getUTCDate(),
    ));
  }

  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
  }

  const text = String(value).trim();
  const m = text.match(/^(\d{1,2})[-\/ ]([A-Za-z]{3,9})[-\/ ](\d{4})$/);
  if (m) {
    const months: Record<string, number> = {
      jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
      apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
      aug: 7, august: 7, sep: 8, sept: 8, september: 8,
      oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
    };
    const month = months[m[2].toLowerCase()];
    if (month !== undefined) {
      return new Date(Date.UTC(Number(m[3]), month, Number(m[1])));
    }
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(Date.UTC(
    parsed.getUTCFullYear(),
    parsed.getUTCMonth(),
    parsed.getUTCDate(),
  ));
}
function hoursToDecimal(value: any): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return value < 1 ? value * 24 : value;
  const text = String(value).trim();
  if (text.includes(':')) {
    const [h, m, s] = text.split(':').map(Number);
    if (!Number.isNaN(h)) return h + (m || 0) / 60 + (s || 0) / 3600;
  }
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function normalizeAttendanceStatus(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s*\/\s*/g, ' / ')
    .toLowerCase();
}

function getShortHoursStatusAction(
  status: unknown,
): 'MANUAL_REVIEW' | 'REGULARIZED_PRESENT' | 'NONE' {
  const normalized = normalizeAttendanceStatus(status);

  if (
    normalized ===
    '0.5 day present, 0.5 day absent / regularized'
  ) {
    return 'REGULARIZED_PRESENT';
  }

  if (
    normalized ===
    '0.5 day present, 0.5 day absent'
  ) {
    return 'MANUAL_REVIEW';
  }

  return 'NONE';
}

function normalizeHeader(value: any) { return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' '); }
function headerMap(row: any[]) {
  const map = new Map<string, number>();
  row.forEach((v, i) => map.set(normalizeHeader(v), i));
  return map;
}
function findCol(map: Map<string, number>, names: string[]) {
  for (const n of names) { const idx = map.get(normalizeHeader(n)); if (idx !== undefined) return idx; }
  return -1;
}
function isWeekendDay(d: Date) {
  const day = d.getUTCDay();
  if (day === 0) return true;
  if (day === 6) { const ordinal = Math.floor((d.getUTCDate() - 1) / 7) + 1; return ordinal === 1 || ordinal === 3; }
  return false;
}
function sameDay(a: Date, b: Date) { return a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10); }
function dateKey(d: Date) { return d.toISOString().slice(0, 10); }
function expectedLogin(status: string, leaveType: 'full' | 'first_half' | 'second_half' | 'half_day' | 'none') {
  if (leaveType === 'full' || leaveType === 'half_day') return null;
  return leaveType === 'first_half' ? '14:30' : '09:30';
}
function timeMinutes(d: Date | null) {
  return d ? d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60 : null;
}

function sourceTimeMinutes(value: any) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'number') {
    const fraction = value - Math.floor(value);

    // Excel time stored as fraction of a day.
    const minutes = Math.round(fraction * 24 * 60);

    return minutes >= 0 && minutes < 24 * 60
      ? minutes
      : null;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return (
      value.getUTCHours() * 60 +
      value.getUTCMinutes() +
      value.getUTCSeconds() / 60
    );
  }

  const text = String(value).trim();

  const match = text.match(
    /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i,
  );

  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] || 0);
  const ampm = (match[4] || '').toUpperCase();

  if (ampm === 'PM' && hour < 12) hour += 12;
  if (ampm === 'AM' && hour === 12) hour = 0;

  return hour * 60 + minute + second / 60;
}

function parseFilename(name: string) {
  const m = name.match(/Attendance_entries_([^_]+)_/i);
  return m?.[1] ?? null;
}
function leaveClassification(status: string, hours: number | null, minHalf: number, maxHalf: number) {
  const s = (status || '').toLowerCase();

  const explicitHalfDay =
    /0\.5\s*day|half\s*-?day|halfday/.test(s) &&
    /(present|absent|leave|half)/.test(s);

  // Full-day STWI Leave: no working hours.
  if (s.includes('stwi leave')) {
    if ((hours === null && s.includes('leave')) || (hours !== null && hours <= 0.25)) {
      return { type: 'full' as const, fraction: 1, manual: false };
    }

    if (hours !== null && hours >= minHalf && hours <= maxHalf) {
      if (s.includes('first half')) {
        return { type: 'first_half' as const, fraction: 0.5, manual: false };
      }

      if (s.includes('second half')) {
        return { type: 'second_half' as const, fraction: 0.5, manual: false };
      }

      // A half-day STWI row without the half explicitly named remains
      // a half-day, but the side worked is determined from the check-in
      // when late-mark logic runs.
      return { type: 'half_day' as const, fraction: 0.5, manual: false };
    }

    if (explicitHalfDay) {
      return { type: 'half_day' as const, fraction: 0.5, manual: false };
    }

    return { type: 'none' as const, fraction: 0, manual: true };
  }

  // Zoho also exports rows such as:
  // "0.5 day Present, 0.5 day Absent"
  // These are legitimate half-day rows even though they do not contain
  // the words "STWI Leave".
  if (explicitHalfDay) {
    return { type: 'half_day' as const, fraction: 0.5, manual: false };
  }

  return { type: 'none' as const, fraction: 0, manual: false };
}

function expectedLoginForAttendance(
  sourceStatus: string,
  leaveType: 'full' | 'first_half' | 'second_half' | 'half_day' | 'none',
  firstCheckInMinutes: number | null,
) {
  if (leaveType === 'full') return null;
  if (leaveType === 'first_half') return '14:30';
  if (leaveType === 'second_half') return '09:30';

  // Generic half-day Zoho status. Determine the working half from the
  // actual first check-in: afternoon check-ins mean the first half was
  // the leave/non-working portion, so expected login is 14:30.
  if (leaveType === 'half_day') {
    if (firstCheckInMinutes != null && firstCheckInMinutes >= 12 * 60) {
      return '14:30';
    }
    return '09:30';
  }

  return expectedLogin(sourceStatus, leaveType);
}

@Injectable()
export class RunsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly deposits: SecurityDepositService) {}

  async list(query: { page?: string; pageSize?: string; year?: string; month?: string; status?: string; search?: string }) {
    const { page, pageSize, skip } = parsePagination(query.page, query.pageSize);
    const year = query.year ? Number(query.year) : undefined;
    const month = query.month ? Number(query.month) : undefined;
    const search = query.search?.trim().toLowerCase();
    const where: any = {
      ...(Number.isInteger(year) ? { year } : {}),
      ...(Number.isInteger(month) && month! >= 1 && month! <= 12 ? { month } : {}),
      ...(query.status ? { status: query.status as any } : {}),
    };
    if (search) {
      const matchingYear = Number(search);
      if (Number.isInteger(matchingYear)) where.year = matchingYear;
    }
    const [data, total] = await this.prisma.$transaction([
      this.prisma.payrollRun.findMany({
        where,
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
        skip,
        take: pageSize,
        include: { _count: { select: { files: true, attendance: true, manualReviews: true, payrollResults: true } } },
      }),
      this.prisma.payrollRun.count({ where }),
    ]);
    return paged(data, total, page, pageSize);
  }

  async create(userId: string, year: number, month: number) {
    if (!year || month < 1 || month > 12) throw new BadRequestException('Invalid year/month');
    const existing = await this.prisma.payrollRun.findUnique({ where: { year_month: { year, month } } });
    if (existing) throw new ConflictException('A payroll run already exists for this month');
    const run = await this.prisma.payrollRun.create({ data: { year, month, createdById: userId } });
    await this.audit.log({ userId, action: 'CREATE', entityType: 'PayrollRun', entityId: run.id, afterJson: { year, month } });
    return run;
  }

  async get(id: string) {
    const run = await this.prisma.payrollRun.findUnique({ where: { id }, include: { files: true, manualReviews: { include: { employee: true, assignedTo: true }, orderBy: { createdAt: 'desc' } }, payrollResults: { include: { employee: true }, orderBy: { employee: { name: 'asc' } } } } });
    if (!run) throw new NotFoundException('Payroll run not found');
    return run;
  }

  async uploadFiles(userId: string, runId: string, files: Express.Multer.File[]) {
    const run = await this.prisma.payrollRun.findUnique({ where: { id: runId } });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (run.status === 'FINALIZED') throw new BadRequestException('Finalized run is locked');
    const out: any[] = [];
    for (const file of files ?? []) {
      const hash = crypto.createHash('sha256').update(file.buffer).digest('hex');
      const duplicate = await this.prisma.attendanceFile.findFirst({ where: { payrollRunId: runId, fileHash: hash } });
      if (duplicate) { out.push({ file: file.originalname, status: 'DUPLICATE' }); continue; }
      const parsed = this.parseAttendanceWorkbook(file.buffer);
      const filenameEmployeeCode = parseFilename(file.originalname);
      const employeeCode = parsed.employeeCode || filenameEmployeeCode;
      const employee = employeeCode ? await this.prisma.employee.findUnique({ where: { employeeCode } }) : null;

      const attendanceFile = await this.prisma.attendanceFile.create({
        data: {
          payrollRunId: runId,
          originalName: file.originalname,
          employeeCode,
          fileHash: hash,
          status: employee ? 'READY' : 'MISMATCH',
        },
      });
      if (!employee) {
        await this.prisma.manualReview.create({ data: { payrollRunId: runId, type: 'EMPLOYEE_MISMATCH', description: `Could not match uploaded file ${file.originalname} to an employee using Employee Code.` } });
        out.push({ file: file.originalname, status: 'MISMATCH', employeeCode });
        continue;
      }
      if (filenameEmployeeCode && parsed.employeeCode && filenameEmployeeCode !== parsed.employeeCode) {
        await this.prisma.manualReview.create({ data: { payrollRunId: runId, employeeId: employee.id, type: 'EMPLOYEE_MISMATCH', description: `Employee ID mismatch: filename suggests ${filenameEmployeeCode}, worksheet contains ${parsed.employeeCode}.` } });
        out.push({ file: file.originalname, status: 'MISMATCH', employeeCode: parsed.employeeCode, filenameEmployeeCode });
        continue;
      }

      const monthRows = parsed.rows.filter((row) =>
        row.date &&
        row.date.getUTCFullYear() === run.year &&
        row.date.getUTCMonth() + 1 === run.month,
      );
      if (!monthRows.length) {
        await this.prisma.attendanceFile.update({
          where: { id: attendanceFile.id },
          data: { status: 'ERROR', errorMessage: 'No attendance rows for this payroll month were found in the file.' },
        });
        out.push({ file: file.originalname, status: 'ERROR', employeeCode, error: 'No attendance rows for this payroll month were found in the file.' });
        continue;
      }

      // A fresh upload for the same employee/month is the new source of truth.
      // Before importing it, clear every run-scoped record belonging to this
      // employee so a replacement Excel file can never inherit old attendance,
      // reviews, or payroll from a previous upload. Other employees are untouched.
      await this.prisma.payrollResult.deleteMany({
        where: { payrollRunId: runId, employeeId: employee.id },
      });
      await this.prisma.manualReview.deleteMany({
        where: { payrollRunId: runId, employeeId: employee.id },
      });

      // Remove attendance records that came from older imported source files,
      // while leaving no stale source data for this employee.
      const oldFiles = await this.prisma.attendanceFile.findMany({
        where: {
          payrollRunId: runId,
          employeeCode: employee.employeeCode,
          id: { not: attendanceFile.id },
        },
        select: { id: true },
      });

      if (oldFiles.length) {
        const oldFileIds = oldFiles.map((f) => f.id);
        const oldRecords = await this.prisma.attendanceRecord.findMany({
          where: { payrollRunId: runId, attendanceFileId: { in: oldFileIds }, employeeId: employee.id },
          select: { id: true },
        });

        if (oldRecords.length) {
          await this.prisma.leaveEvent.deleteMany({
            where: { attendanceRecordId: { in: oldRecords.map((r) => r.id) } },
          });
          await this.prisma.attendanceRecord.deleteMany({
            where: { id: { in: oldRecords.map((r) => r.id) } },
          });
        }

        await this.prisma.attendanceFile.deleteMany({
          where: { id: { in: oldFileIds } },
        });
      }

      // Manual rows from an earlier version of this run are also stale when a
      // fresh employee workbook is uploaded. Keep employee data isolated.
      const remainingRunRecords = await this.prisma.attendanceRecord.findMany({
        where: { payrollRunId: runId, employeeId: employee.id },
        select: { id: true },
      });
      if (remainingRunRecords.length) {
        await this.prisma.leaveEvent.deleteMany({
          where: { attendanceRecordId: { in: remainingRunRecords.map((r) => r.id) } },
        });
        await this.prisma.attendanceRecord.deleteMany({
          where: { id: { in: remainingRunRecords.map((r) => r.id) } },
        });
      }

      try {
        const minHalf = await this.ruleNumber('half_day_min_hours', 4);
        const maxHalf = await this.ruleNumber('half_day_max_hours', 5.5);
        let imported = 0;
        for (const row of monthRows) {
          const workDate = row.date;
          if (!workDate) continue;
          if (workDate.getUTCFullYear() !== run.year || workDate.getUTCMonth() + 1 !== run.month) continue;
          // Attendance processing follows the Zoho source:
          // Total Hours drives leave/half-day classification and is shown in
          // the Attendance table. Payable Hours remains separate source data.
          // const classificationHours = row.totalHours;
          // const workedHours = row.totalHours;
          // const classification = leaveClassification(row.status, classificationHours, minHalf, maxHalf);
          // const holiday = row.status.toLowerCase().includes('holiday');
          // const weekend = isWeekendDay(workDate);
          // const first = row.firstCheckIn;
          // let status: any = holiday ? 'HOLIDAY' : weekend ? 'WEEK_OFF' : 'PRESENT';
          // let manual = false;
          // let manualType: any = null;
          // if (classification.type === 'full') status = 'STWI_LEAVE';
          // if (classification.fraction === 0.5) status = 'HALF_DAY';
          // if (classification.manual) { status = 'MANUAL_REVIEW'; manual = true; manualType = 'AMBIGUOUS_LEAVE'; }

          // // Minimum-work-hours rule:
          // //   * Normal working day requires 8 hours.
          // //   * Half-day working period requires 4 hours.
          // // Any shortfall becomes proportional leave (missing hours / 8),
          // // while preserving the source status shown in the UI. Full-day leave,
          // // weekends and holidays are exempt because no work is expected.
          // const baseLeaveFraction = classification.fraction || 0;
          // const requiredHours = classification.type === 'half_day' || classification.type === 'first_half' || classification.type === 'second_half'
          //   ? 4
          //   : 8;
          // const workedForThreshold = row.totalHours;
          // const shortfallLeave = (!holiday && !weekend && classification.type !== 'full' && workedForThreshold != null && workedForThreshold < requiredHours)
          //   ? hoursToLeaveFraction(requiredHours, workedForThreshold)
          //   : 0;
          // const leaveFraction = money(Math.min(1, baseLeaveFraction + shortfallLeave));

          const classificationHours = row.totalHours;
const workedHours = row.totalHours;

const classification = leaveClassification(
  row.status,
  classificationHours,
  minHalf,
  maxHalf,
);

const holiday =
  row.status.toLowerCase().includes('holiday');

const weekend = isWeekendDay(workDate);
const first = row.firstCheckIn;

let status: any =
  holiday
    ? 'HOLIDAY'
    : weekend
      ? 'WEEK_OFF'
      : 'PRESENT';

let manual = false;
let manualType: any = null;

// Identify the two special Zoho short-hours statuses.
const shortHoursAction =
  getShortHoursStatusAction(row.status);

const isRegularizedStatus =
  shortHoursAction === 'REGULARIZED_PRESENT';

const isManualShortHoursStatus =
  shortHoursAction === 'MANUAL_REVIEW';

  

// Existing STWI Leave classification.
if (classification.type === 'full') {
  status = 'STWI_LEAVE';
}

if (classification.fraction === 0.5) {
  status = 'HALF_DAY';
}

if (classification.manual) {
  status = 'MANUAL_REVIEW';
  manual = true;
  manualType = 'AMBIGUOUS_LEAVE';
}

// Required working hours.
const requiredHours =
  classification.type === 'half_day' ||
  classification.type === 'first_half' ||
  classification.type === 'second_half'
    ? 4
    : 8;

const workedForThreshold = row.totalHours;

const isShortHours =
  !holiday &&
  !weekend &&
  classification.type !== 'full' &&
  workedForThreshold != null &&
  workedForThreshold < requiredHours;

// Normal V1.6 short-hours calculation.
const baseLeaveFraction =
  classification.fraction || 0;

const shortfallLeave =
  isShortHours
    ? hoursToLeaveFraction(
        requiredHours,
        workedForThreshold!,
      )
    : 0;

let leaveFraction = money(
  Math.min(
    1,
    baseLeaveFraction + shortfallLeave,
  ),
);

/*
 * CASE 1
 *
 * Excel:
 * "0.5 day Present, 0.5 day Absent"
 *
 * When hours are below the required hours:
 * - keep in Manual Review
 * - DO NOT automatically deduct leave
 * - DO NOT create automatic salary deduction
 */


if (
  isShortHours &&
  shortHoursAction === 'MANUAL_REVIEW'
) {
  status = 'MANUAL_REVIEW';

  manual = true;
  manualType = 'UNEXPECTED_DURATION';

  // HR will decide the final treatment manually.
  leaveFraction = 0;
}

/*
 * CASE 2
 *
 * Excel:
 * "0.5 day Present, 0.5 day Absent / Regularized"
 *
 * Regularized always means:
 * - FULL-DAY PRESENT
 * - no leave
 * - no salary deduction
 * - no Manual Review
 *
 * This override applies regardless of worked hours.
 */
if (shortHoursAction === 'REGULARIZED_PRESENT') {
  status = 'PRESENT';

  manual = false;
  manualType = null;

  leaveFraction = 0;
}

          const firstMin = row.firstCheckInMinutes ?? timeMinutes(first);
          const expected = expectedLoginForAttendance(row.status, classification.type, firstMin);
          let late = false;
          let lateMinutes = 0;

          if (!holiday && !weekend && expected && firstMin != null) {
            const [h, m] = expected.split(':').map(Number);
            const expMin = h * 60 + m;
            if (firstMin > expMin) {
              late = true;
              lateMinutes = Math.round(firstMin - expMin);
            }
          }

          if (!holiday && !weekend && classification.type !== 'full' && !first) {
            status = 'MANUAL_REVIEW';
            manual = true;
            manualType = 'MISSING_CHECKIN';
          }
          const record = await this.prisma.attendanceRecord.upsert({ where: { payrollRunId_employeeId_workDate: { payrollRunId: runId, employeeId: employee.id, workDate } }, update: { attendanceFileId: attendanceFile.id, firstCheckIn: first, lastCheckOut: row.lastCheckOut, workedHours, sourceStatus: row.status, status, isLate: late, lateMinutes, leaveFraction: leaveFraction || null, isHoliday: holiday, isWeekOff: weekend }, create: { payrollRunId: runId, employeeId: employee.id, attendanceFileId: attendanceFile.id, workDate, firstCheckIn: first, lastCheckOut: row.lastCheckOut, workedHours, sourceStatus: row.status, status, isLate: late, lateMinutes, leaveFraction: leaveFraction || null, isHoliday: holiday, isWeekOff: weekend } });
          
          // The uploaded Excel row is now the source of truth for this date.
          // Remove any stale OPEN MISSING_CHECKIN review created by an earlier
          // processing pass. Keep MISSING_CHECKIN only when this row is actually
          // a normal working-day record with no check-in.
          const suppliedAttendance =
            Boolean(first) ||
            holiday ||
            weekend ||
            leaveFraction > 0 ||
            status === 'HOLIDAY' ||
            status === 'WEEK_OFF' ||
            status === 'STWI_LEAVE' ||
            status === 'HALF_DAY';

          if (suppliedAttendance) {
            await this.prisma.manualReview.deleteMany({
              where: {
                payrollRunId: runId,
                employeeId: employee.id,
                type: 'MISSING_CHECKIN',
                status: 'OPEN',
                description: {
                  contains: dateKey(workDate),
                },
              },
            });
          }
          
          // if (leaveFraction > 0) {
          //   const leaveType = classification.type === 'full'
          //     ? 'FULL_DAY'
          //     : (shortfallLeave > 0 ? 'HOUR_SHORTFALL' : 'HALF_DAY');
          //   await this.prisma.leaveEvent.upsert({
          //     where: { attendanceRecordId: record.id },
          //     update: { leaveFraction, leaveType },
          //     create: { payrollRunId: runId, employeeId: employee.id, attendanceRecordId: record.id, leaveFraction, leaveType },
          //   });
          // }

          if (leaveFraction > 0) {
  const leaveType =
    classification.type === 'full'
      ? 'FULL_DAY'
      : (shortfallLeave > 0
          ? 'HOUR_SHORTFALL'
          : 'HALF_DAY');

  await this.prisma.leaveEvent.upsert({
    where: {
      attendanceRecordId: record.id,
    },
    update: {
      leaveFraction,
      leaveType,
    },
    create: {
      payrollRunId: runId,
      employeeId: employee.id,
      attendanceRecordId: record.id,
      leaveFraction,
      leaveType,
    },
  });
} else {
  /*
   * Important for Regularized rows:
   * remove any old leave event if this row previously
   * had a leave classification.
   */
  await this.prisma.leaveEvent.deleteMany({
    where: {
      attendanceRecordId: record.id,
    },
  });
}


          if (manual && manualType) await this.ensureReview(runId, employee.id, manualType, `Attendance review required for ${workDate.toISOString().slice(0,10)} from ${file.originalname}.`);
          imported++;
        }
        if (!imported) {
          await this.prisma.attendanceFile.update({ where: { id: attendanceFile.id }, data: { status: 'ERROR', errorMessage: 'No attendance rows for this payroll month were found in the file.' } });
          out.push({ file: file.originalname, status: 'ERROR', employeeCode, error: 'No attendance rows for this payroll month were found in the file.' });
        } else {
          out.push({ file: file.originalname, status: 'READY', employeeCode, imported });
        }
      } catch (e) {
        await this.prisma.attendanceFile.update({ where: { id: attendanceFile.id }, data: { status: 'ERROR', errorMessage: e instanceof Error ? e.message : String(e) } });
        out.push({ file: file.originalname, status: 'ERROR', employeeCode, error: e instanceof Error ? e.message : String(e) });
      }
    }
    await this.audit.log({ userId, action: 'UPLOAD_ATTENDANCE', entityType: 'PayrollRun', entityId: runId, afterJson: out });
    return out;
  }

  async removeRun(userId: string, runId: string) {
    const run = await this.prisma.payrollRun.findUnique({ where: { id: runId } });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (run.status === 'FINALIZED') throw new BadRequestException('Finalized run is locked');
    await this.prisma.payrollRun.delete({ where: { id: runId } });
    await this.audit.log({ userId, action: 'DELETE', entityType: 'PayrollRun', entityId: runId, beforeJson: run });
    return { deleted: true, id: runId };
  }

  async deleteFile(userId: string, runId: string, fileId: string) {
    const run = await this.prisma.payrollRun.findUnique({ where: { id: runId } });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (run.status === 'FINALIZED') throw new BadRequestException('Finalized run is locked');
    const file = await this.prisma.attendanceFile.findFirst({ where: { id: fileId, payrollRunId: runId } });
    if (!file) throw new NotFoundException('Attendance file not found');
    const records = await this.prisma.attendanceRecord.findMany({ where: { attendanceFileId: fileId }, select: { id: true, employeeId: true } });
    const employeeIds = [...new Set(records.map((x) => x.employeeId))];
    if (records.length) await this.prisma.leaveEvent.deleteMany({ where: { attendanceRecordId: { in: records.map((x) => x.id) } } });
    await this.prisma.attendanceRecord.deleteMany({ where: { attendanceFileId: fileId } });
    await this.prisma.attendanceFile.delete({ where: { id: fileId } });
    if (employeeIds.length) {
      await this.prisma.payrollResult.deleteMany({ where: { payrollRunId: runId, employeeId: { in: employeeIds } } });
      await this.prisma.manualReview.deleteMany({ where: { payrollRunId: runId, employeeId: { in: employeeIds } } });
    }
    await this.audit.log({ userId, action: 'DELETE_ATTENDANCE_FILE', entityType: 'AttendanceFile', entityId: fileId, afterJson: { runId, originalName: file.originalName } });
    return { deleted: true, id: fileId };
  }

  private attendancePayload(runId: string, body: any) {
    const workDate = asDate(body.workDate);
    if (!workDate) throw new BadRequestException('Valid workDate is required.');
    const d = new Date(Date.UTC(workDate.getUTCFullYear(), workDate.getUTCMonth(), workDate.getUTCDate()));
    const status = String(body.status || 'PRESENT') as any;
    const hours = body.workedHours === '' || body.workedHours == null ? null : Number(body.workedHours);
    const firstCheckIn = body.firstCheckIn ? asDate(body.firstCheckIn) : null;
    const lastCheckOut = body.lastCheckOut ? asDate(body.lastCheckOut) : null;
    const leaveFraction = body.leaveFraction === '' || body.leaveFraction == null ? 0 : Number(body.leaveFraction);
    const lateMinutes = body.lateMinutes == null || body.lateMinutes === '' ? 0 : Number(body.lateMinutes);
    return { d, status, hours: Number.isFinite(hours) ? hours : null, firstCheckIn, lastCheckOut, leaveFraction: Number.isFinite(leaveFraction) ? leaveFraction : 0, isLate: Boolean(body.isLate), lateMinutes: Number.isFinite(lateMinutes) ? lateMinutes : 0 };
  }

  async addManualAttendance(userId: string, runId: string, body: any) {
    const run = await this.prisma.payrollRun.findUnique({ where: { id: runId } });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (run.status === 'FINALIZED') throw new BadRequestException('Finalized run is locked');
    const employee = await this.prisma.employee.findUnique({ where: { id: String(body.employeeId) } });
    if (!employee) throw new NotFoundException('Employee not found');
    const p = this.attendancePayload(runId, body);
    const record = await this.prisma.attendanceRecord.upsert({
      where: { payrollRunId_employeeId_workDate: { payrollRunId: runId, employeeId: employee.id, workDate: p.d } },
      update: { firstCheckIn: p.firstCheckIn, lastCheckOut: p.lastCheckOut, workedHours: p.hours, sourceStatus: body.sourceStatus ?? 'MANUAL ENTRY', status: p.status, isLate: p.isLate, lateMinutes: p.lateMinutes, leaveFraction: p.leaveFraction || null, isHoliday: Boolean(body.isHoliday), isWeekOff: Boolean(body.isWeekOff), manualNotes: body.manualNotes ?? null },
      create: { payrollRunId: runId, employeeId: employee.id, workDate: p.d, firstCheckIn: p.firstCheckIn, lastCheckOut: p.lastCheckOut, workedHours: p.hours, sourceStatus: body.sourceStatus ?? 'MANUAL ENTRY', status: p.status, isLate: p.isLate, lateMinutes: p.lateMinutes, leaveFraction: p.leaveFraction || null, isHoliday: Boolean(body.isHoliday), isWeekOff: Boolean(body.isWeekOff), manualNotes: body.manualNotes ?? null },
      include: { employee: true },
    });
    await this.prisma.leaveEvent.deleteMany({ where: { attendanceRecordId: record.id } });
    if (p.leaveFraction > 0) await this.prisma.leaveEvent.create({ data: { payrollRunId: runId, employeeId: employee.id, attendanceRecordId: record.id, leaveFraction: p.leaveFraction, leaveType: p.leaveFraction === 1 ? 'FULL_DAY' : 'HALF_DAY', approved: true } });
    await this.audit.log({ userId, employeeId: employee.id, action: 'MANUAL_ATTENDANCE_UPSERT', entityType: 'AttendanceRecord', entityId: record.id, afterJson: record });
    return record;
  }

  async updateAttendance(userId: string, runId: string, attendanceId: string, body: any) {

    const run =
  await this.prisma.payrollRun.findUnique({
    where: { id: runId },
  });

if (!run) {
  throw new NotFoundException(
    'Payroll run not found',
  );
}

if (run.status === 'FINALIZED') {
  throw new BadRequestException(
    'Finalized run is locked',
  );
}
    const existing = await this.prisma.attendanceRecord.findFirst({ where: { id: attendanceId, payrollRunId: runId } });
    if (!existing) throw new NotFoundException('Attendance record not found');
    const p = this.attendancePayload(runId, body);
    const updated = await this.prisma.attendanceRecord.update({ where: { id: attendanceId }, data: { workDate: p.d, firstCheckIn: p.firstCheckIn, lastCheckOut: p.lastCheckOut, workedHours: p.hours, sourceStatus: body.sourceStatus ?? existing.sourceStatus ?? 'MANUAL ENTRY', status: p.status, isLate: p.isLate, lateMinutes: p.lateMinutes, leaveFraction: p.leaveFraction || null, isHoliday: Boolean(body.isHoliday), isWeekOff: Boolean(body.isWeekOff), manualNotes: body.manualNotes ?? existing.manualNotes }, include: { employee: true } });
    await this.prisma.leaveEvent.deleteMany({ where: { attendanceRecordId: attendanceId } });
    if (p.leaveFraction > 0) await this.prisma.leaveEvent.create({ data: { payrollRunId: runId, employeeId: existing.employeeId, attendanceRecordId: attendanceId, leaveFraction: p.leaveFraction, leaveType: p.leaveFraction === 1 ? 'FULL_DAY' : 'HALF_DAY', approved: true } });
    await this.audit.log({ userId, employeeId: existing.employeeId, action: 'UPDATE_ATTENDANCE', entityType: 'AttendanceRecord', entityId: attendanceId, beforeJson: existing, afterJson: updated });
    return updated;
  }

  async deleteAttendance(userId: string, runId: string, attendanceId: string) {

    const run =
  await this.prisma.payrollRun.findUnique({
    where: { id: runId },
  });

if (!run) {
  throw new NotFoundException(
    'Payroll run not found',
  );
}

if (run.status === 'FINALIZED') {
  throw new BadRequestException(
    'Finalized run is locked',
  );
}

    const existing = await this.prisma.attendanceRecord.findFirst({ where: { id: attendanceId, payrollRunId: runId } });
    if (!existing) throw new NotFoundException('Attendance record not found');
    await this.prisma.leaveEvent.deleteMany({ where: { attendanceRecordId: attendanceId } });
    await this.prisma.attendanceRecord.delete({ where: { id: attendanceId } });
    await this.audit.log({ userId, employeeId: existing.employeeId, action: 'DELETE_ATTENDANCE', entityType: 'AttendanceRecord', entityId: attendanceId, beforeJson: existing });
    return { deleted: true, id: attendanceId };
  }

  async deleteReview(userId: string, reviewId: string) {
    const review = await this.prisma.manualReview.findUnique({ where: { id: reviewId } });
    if (!review) throw new NotFoundException('Review not found');
    const run =
  await this.prisma.payrollRun.findUnique({
    where: {
      id: review.payrollRunId,
    },
  });

if (!run) {
  throw new NotFoundException(
    'Payroll run not found',
  );
}

if (run.status === 'FINALIZED') {
  throw new BadRequestException(
    'Finalized run is locked',
  );
}
    if (review.status === 'RESOLVED') throw new BadRequestException('Resolved reviews are retained for audit and cannot be deleted.');
    await this.prisma.manualReview.delete({ where: { id: reviewId } });
    await this.audit.log({ userId, employeeId: review.employeeId ?? undefined, action: 'DELETE_REVIEW', entityType: 'ManualReview', entityId: reviewId, beforeJson: review });
    return { deleted: true, id: reviewId };
  }

  parseAttendanceWorkbook(buffer: Buffer) {
const wb = XLSX.read(buffer, {
  type: 'buffer',
  cellDates: false,
  raw: true,
});
    // Prefer the Zoho "Attendance(Hours)" worksheet when available.
    // Otherwise select the first worksheet that contains Date + Status.
    let sheetName =
      wb.SheetNames.find((name) => normalizeHeader(name) === 'attendance(hours)') ??
      wb.SheetNames.find((name) => {
        const ws = wb.Sheets[name];
        const rows = XLSX.utils.sheet_to_json(ws, {
          header: 1,
          defval: null,
          raw: true,
        }) as any[][];
        return rows.slice(0, 10).some((row) => {
          const normalized = (row || []).map((c: any) => normalizeHeader(c));
          return normalized.includes('date') && normalized.includes('status');
        });
      }) ??
      wb.SheetNames[0];

    const sheet = wb.Sheets[sheetName];
    const raw: any[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: null,
      raw: true,
    }) as any[][];

    let employeeCode: string | null = null;

    // Zoho format:
    // Employee Id | Employee Name | Date | ...
    // 12           | Dixit         | 01-Aug-2026 | ...
    const employeeHeaderNames = [
      'employee id',
      'employee code',
      'employeeid',
      'employee code/id',
      'employee no',
      'employee number',
      'emp id',
      'emp code',
    ];

    let employeeIdCol = -1;
    let employeeHeaderRow = -1;

    for (let r = 0; r < Math.min(raw.length, 20); r++) {
      const row = raw[r] || [];

      for (let c = 0; c < row.length; c++) {
        const label = normalizeHeader(row[c]);

        if (employeeHeaderNames.includes(label)) {
          employeeIdCol = c;
          employeeHeaderRow = r;
          break;
        }
      }

      if (employeeIdCol >= 0) break;
    }

    // Read the employee code from the first data row under the Employee Id column.
    if (employeeIdCol >= 0 && employeeHeaderRow >= 0) {
      for (let r = employeeHeaderRow + 1; r < raw.length; r++) {
        const candidate = raw[r]?.[employeeIdCol];

        if (
          candidate !== null &&
          candidate !== undefined &&
          String(candidate).trim()
        ) {
          employeeCode = String(candidate).trim();
          break;
        }
      }
    }

    // Find the attendance header row.
    let headerIdx = raw.findIndex((r) => {
      if (!Array.isArray(r)) return false;

      const normalized = r.map((c) => normalizeHeader(c));

      return normalized.includes('date') && normalized.includes('status');
    });

    if (headerIdx < 0) headerIdx = 0;

    const headers = headerMap(raw[headerIdx] || []);

    const dateIdx = findCol(headers, ['Date', 'Attendance Date']);

    // IMPORTANT:
    // Zoho exports both Total Hours and Payable Hours.
    // Payable Hours is the safer payroll attendance value because
    // an overnight checkout can make Total Hours misleading
    // (e.g. Dixit's 17-Aug record: Total Hours 10:41, Payable Hours 04:13).
    const payableHoursIdx = findCol(headers, [
  'Payable Hours',
  'Payable Hour',
  'Payable Hrs',
]);

const totalHoursIdx = findCol(headers, [
  'Total Hours',
  'Total Hours Worked',
  'Hours',
]);

    const statusIdx = findCol(headers, ['Status', 'Attendance Status']);
    const firstIdx = findCol(headers, [
      'First Check-In',
      'First Check In',
      'Check-In',
      'Login',
    ]);
    const lastIdx = findCol(headers, [
      'Last Check-Out',
      'Last Check Out',
      'Check-Out',
      'Logout',
    ]);

    if (dateIdx < 0 || statusIdx < 0) {
      throw new Error('Attendance file must contain Date and Status columns.');
    }

    const rows: any[] = [];

    for (let i = headerIdx + 1; i < raw.length; i++) {
      const r = raw[i];
      const d = asAttendanceDate(r[dateIdx]);

      if (!d) continue;

      const rawStatus = String(r[statusIdx] ?? '').trim();

      // Preserve both raw Total Hours and Zoho Payable Hours.
      // Total Hours is the attendance/source value; Payable Hours is retained
      // separately for future payroll use and must not replace Total Hours in
      // the attendance screen.
    rows.push({
  date: d,

  // Total Hours is the Zoho attendance/source value.
  totalHours: totalHoursIdx >= 0
    ? hoursToDecimal(r[totalHoursIdx])
    : null,

  // Payable Hours is retained separately.
  payableHours: payableHoursIdx >= 0
    ? hoursToDecimal(r[payableHoursIdx])
    : null,

  status: rawStatus,

  firstCheckIn: asDate(r[firstIdx]),

  firstCheckInMinutes: sourceTimeMinutes(r[firstIdx]),

  lastCheckOut: asDate(r[lastIdx]),
});
    }

    return {
      employeeCode,
      rows,
      sheetName,
    };
  }

  async processRun(userId: string, runId: string) {
    const run = await this.prisma.payrollRun.findUnique({ where: { id: runId } });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (run.status === 'FINALIZED') throw new BadRequestException('Finalized run is locked');

    const sourceFiles = await this.prisma.attendanceFile.findMany({
      where: { payrollRunId: runId, status: { in: ['READY', 'PROCESSED'] } },
    });
    if (!sourceFiles.length) {
      throw new BadRequestException('Upload at least one valid attendance Excel file before processing.');
    }

    await this.prisma.payrollRun.update({ where: { id: runId }, data: { status: 'PROCESSING' } });

    const importedSourceRows = await this.prisma.attendanceRecord.findMany({
      where: { payrollRunId: runId, attendanceFileId: { not: null } },
      select: { employeeId: true },
      distinct: ['employeeId'],
    });
    const sourceEmployeeIds = importedSourceRows.map((r) => r.employeeId);

    const employees = await this.prisma.employee.findMany({
      where: { id: { in: sourceEmployeeIds }, status: 'ACTIVE' },
      include: {
        salaryHistory: {
          where: { effectiveFrom: { lte: new Date(Date.UTC(run.year, run.month, 31, 23, 59, 59)) } },
          orderBy: { effectiveFrom: 'desc' },
          take: 2,
        },
      },
    });

    const importedCount = await this.prisma.attendanceRecord.count({ where: { payrollRunId: runId, attendanceFileId: { not: null } } });
    if (!importedCount) {
      throw new BadRequestException('No attendance records were imported from the uploaded files. Check the Excel format and employee IDs.');
    }

    const holidayDates = await this.prisma.attendanceRecord.findMany({
      where: { payrollRunId: runId, isHoliday: true },
      select: { workDate: true },
    });
    const holidaySet = new Set(holidayDates.map((x) => dateKey(x.workDate)));
    const totalDays = new Date(Date.UTC(run.year, run.month, 0)).getUTCDate();

    for (const emp of employees) {
      if (!emp.salaryHistory[0]) continue;

      // Rebuild MISSING_CHECKIN reviews for this employee from the current
      // attendance source. This removes stale reviews left by older processing
      // passes/imports (including the previous one-day date-shift bug).
      await this.prisma.manualReview.deleteMany({
        where: {
          payrollRunId: runId,
          employeeId: emp.id,
          type: 'MISSING_CHECKIN',
          status: 'OPEN',
        },
      });

      for (let day = 1; day <= totalDays; day++) {
        const d = new Date(Date.UTC(run.year, run.month - 1, day));
        const existing = await this.prisma.attendanceRecord.findUnique({
          where: {
            payrollRunId_employeeId_workDate: {
              payrollRunId: runId,
              employeeId: emp.id,
              workDate: d,
            },
          },
        });

        if (existing) {
          // If an attendance record now exists with a real check-in, or the date
          // is a legitimate holiday/week-off/leave, an older MISSING_CHECKIN
          // review is stale and must not block payroll.
          const validSourceRecord =
            Boolean(existing.firstCheckIn) ||
            existing.isHoliday ||
            existing.isWeekOff ||
            Number(existing.leaveFraction ?? 0) > 0 ||
            ['HOLIDAY', 'WEEK_OFF', 'STWI_LEAVE', 'HALF_DAY'].includes(existing.status);

          if (validSourceRecord) {
            await this.prisma.manualReview.deleteMany({
              where: {
                payrollRunId: runId,
                employeeId: emp.id,
                type: 'MISSING_CHECKIN',
                status: 'OPEN',
                description: {
                  contains: dateKey(d),
                },
              },
            });
          }

          continue;
        }

        const holiday = holidaySet.has(dateKey(d));
        const weekend = isWeekendDay(d);
        const status: any = holiday
          ? 'HOLIDAY'
          : weekend
            ? 'WEEK_OFF'
            : 'MANUAL_REVIEW';

        await this.prisma.attendanceRecord.create({
          data: {
            payrollRunId: runId,
            employeeId: emp.id,
            workDate: d,
            status,
            isHoliday: holiday,
            isWeekOff: weekend,
          },
        });

        if (!holiday && !weekend) {
          await this.ensureReview(
            runId,
            emp.id,
            'MISSING_CHECKIN',
            `No attendance record was found for ${dateKey(d)}.`,
          );
        }
      }
    }

    // Clean up any remaining stale MISSING_CHECKIN reviews for imported source
    // dates that now have real attendance records.
    const importedAttendance = await this.prisma.attendanceRecord.findMany({
      where: {
        payrollRunId: runId,
        OR: [
          { firstCheckIn: { not: null } },
          { isHoliday: true },
          { isWeekOff: true },
          { leaveFraction: { gt: 0 } },
        ],
      },
      select: {
        employeeId: true,
        workDate: true,
      },
    });

    for (const row of importedAttendance) {
      await this.prisma.manualReview.deleteMany({
        where: {
          payrollRunId: runId,
          employeeId: row.employeeId,
          type: 'MISSING_CHECKIN',
          status: 'OPEN',
          description: {
            contains: dateKey(row.workDate),
          },
        },
      });
    }

    await this.prisma.attendanceFile.updateMany({
      where: { payrollRunId: runId, status: 'READY' },
      data: { status: 'PROCESSED' },
    });

    const openReviews = await this.prisma.manualReview.count({ where: { payrollRunId: runId, status: 'OPEN' } });
    const status = 'REVIEW';
    const updated = await this.prisma.payrollRun.update({ where: { id: runId }, data: { status, processedAt: new Date() } });
    await this.audit.log({ userId, action: 'PROCESS_ATTENDANCE', entityType: 'PayrollRun', entityId: runId, afterJson: { importedCount, openReviews } });
    return { run: updated, importedCount, openReviews };
  }

  private async ensureReview(runId: string, employeeId: string, type: any, description: string) {
    const existing = await this.prisma.manualReview.findFirst({ where: { payrollRunId: runId, employeeId, type, description } });
    if (!existing) await this.prisma.manualReview.create({ data: { payrollRunId: runId, employeeId, type, description } });
  }

  async reviews(runId: string, query: { page?: string; pageSize?: string; status?: string; type?: string; employeeId?: string; search?: string; penaltyPresent?: string; doubleDeductionLeave?: string }) {
    const { page, pageSize, skip } = parsePagination(query.page, query.pageSize);
    const penaltyPresent = parseBoolean(query.penaltyPresent);
    const doubleDeduction = parseBoolean(query.doubleDeductionLeave);
    const search = query.search?.trim();
    const where: any = {
      payrollRunId: runId,
      ...(query.status ? { status: query.status as any } : {}),
      ...(query.type ? { type: query.type as any } : {}),
      ...(query.employeeId ? { employeeId: query.employeeId } : {}),
      ...(penaltyPresent !== undefined ? { penaltyAmount: penaltyPresent ? { gt: 0 } : { equals: 0 } } : {}),
      ...(doubleDeduction !== undefined ? { doubleDeductionLeave: doubleDeduction } : {}),
      ...(search ? { employee: { OR: [{ name: { contains: search } }, { employeeCode: { contains: search } }] } } : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.manualReview.findMany({ where, include: { employee: true }, orderBy: { createdAt: 'desc' }, skip, take: pageSize }),
      this.prisma.manualReview.count({ where }),
    ]);
    return paged(data, total, page, pageSize);
  }

  async resolveReview(userId: string, reviewId: string, body: { resolution?: string; penaltyAmount?: number; doubleDeductionLeave?: boolean; status?: 'RESOLVED' | 'REJECTED' }) {
    const review = await this.prisma.manualReview.findUnique({ where: { id: reviewId } });
    if (!review) throw new NotFoundException('Review not found');
    const run = await this.prisma.payrollRun.findUnique({ where: { id: review.payrollRunId } });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (run.status === 'FINALIZED') throw new BadRequestException('Finalized run is locked');
    if (review.status !== 'OPEN') throw new BadRequestException('Review is already closed');
    const updated = await this.prisma.manualReview.update({ where: { id: reviewId }, data: { status: body.status ?? 'RESOLVED', resolution: body.resolution, penaltyAmount: body.penaltyAmount, doubleDeductionLeave: body.doubleDeductionLeave ?? review.doubleDeductionLeave, assignedToId: userId, resolvedAt: new Date() } });
    await this.audit.log({ userId, employeeId: review.employeeId ?? undefined, action: 'RESOLVE', entityType: 'ManualReview', entityId: reviewId, beforeJson: review, afterJson: updated });
    return updated;
  }

  async calculatePayroll(runId: string, userId: string) {
    const run = await this.prisma.payrollRun.findUnique({ where: { id: runId } });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (run.status === 'FINALIZED') throw new BadRequestException('Finalized run is locked');
    const sourceCount = await this.prisma.attendanceFile.count({ where: { payrollRunId: runId, status: 'PROCESSED' } });
    if (!sourceCount) throw new BadRequestException('Process at least one uploaded attendance file before calculating payroll.');
    const openReviews = await this.prisma.manualReview.count({ where: { payrollRunId: runId, status: 'OPEN' } });
    if (openReviews) throw new BadRequestException(`Resolve all ${openReviews} open Manual Review item(s) before calculating payroll.`);

    const rules = await this.rulesSnapshot(run.year, run.month);
    const sourceEmployeeRows = await this.prisma.attendanceRecord.findMany({
      where: { payrollRunId: runId, attendanceFileId: { not: null } },
      select: { employeeId: true },
      distinct: ['employeeId'],
    });
    const sourceEmployeeIds = sourceEmployeeRows.map((r) => r.employeeId);
    if (!sourceEmployeeIds.length) throw new BadRequestException('No uploaded attendance records are available for payroll calculation.');

    const employees = await this.prisma.employee.findMany({
      where: { id: { in: sourceEmployeeIds }, status: 'ACTIVE' },
      include: {
        salaryHistory: {
          where: { effectiveFrom: { lte: new Date(Date.UTC(run.year, run.month, 31, 23, 59, 59)) } },
          orderBy: { effectiveFrom: 'desc' },
          take: 2,
        },
      },
    });

    for (const emp of employees) {
      const gross = emp.salaryHistory[0] ? Number(emp.salaryHistory[0].grossSalary) : 0;
      if (!gross) continue;

      const [records, reviews, existingResult] = await Promise.all([
        this.prisma.attendanceRecord.findMany({ where: { payrollRunId: runId, employeeId: emp.id }, orderBy: { workDate: 'asc' } }),
        this.prisma.manualReview.findMany({ where: { payrollRunId: runId, employeeId: emp.id, status: 'RESOLVED' } }),
        this.prisma.payrollResult.findUnique({ where: { payrollRunId_employeeId: { payrollRunId: runId, employeeId: emp.id } } }),
      ]);

      const calendarDays = new Date(Date.UTC(run.year, run.month, 0)).getUTCDate();
      const weekOffDays = records.filter(r => r.isWeekOff && !r.isHoliday).length;
      const holidayDays = records.filter(r => r.isHoliday && !r.isWeekOff).length;
      const leaveUsed = money(records.reduce((s, r) => s + Number(r.leaveFraction ?? 0), 0));
      const lateMarks = records.filter(r => r.isLate).length;
      const lateLeaveDeduction = Math.floor(lateMarks / rules.late_mark_threshold) * rules.leave_per_threshold;
      const doubleDeductionLeave = reviews.reduce((s, r) => s + (r.doubleDeductionLeave ? rules.double_deduction_leave_days : 0), 0);

      // Paid leave is applied after combining actual leave + late-mark leave
      // + any explicit double-deduction leave.
      const totalDeductionLeave = money(
        Math.max(
          0,
          leaveUsed + lateLeaveDeduction + doubleDeductionLeave - rules.paid_leave_allowance,
        ),
      );

      // Keep the trace fields meaningful: "excessLeaveDeduction" is the portion
      // of the final deduction that remains after late/double-deduction leave.
      const excessLeaveDeduction = money(
        Math.max(0, totalDeductionLeave - lateLeaveDeduction - doubleDeductionLeave),
      );

      const penalty = money(reviews.reduce((s, r) => s + Number(r.penaltyAmount ?? 0), 0));

      // Per-day salary = gross salary / actual number of calendar days in month.
      const dailySalary = gross / calendarDays;

      // A half-day is represented as 0.5 in leaveFraction, so it automatically
      // deducts 0.5 x daily salary when it falls into total deductible leave.
      const attendanceDeduction = money(dailySalary * totalDeductionLeave);

      // Confirmed current STWI rule: gross salary strictly greater than ₹12,000
      // attracts ₹200 P.Tax.
      const ptax = gross > rules.ptax_threshold ? rules.ptax_amount : 0;
      const held = await this.deposits.getHeldAmount(emp.id);

      let deposit = await this.prisma.securityDeposit.findFirst({
        where: { employeeId: emp.id, status: 'ACTIVE' },
        include: { transactions: true },
        orderBy: { createdAt: 'desc' },
      });

      const requiredDeposit = Math.max(0, gross);
      const additional = Math.max(0, requiredDeposit - held);

      if (deposit) {
        deposit = await this.prisma.securityDeposit.update({
          where: { id: deposit.id },
          data: {
            currentSalary: gross,
            requiredDeposit,
            alreadyHeld: held,
            additionalRequired: additional,
            installmentCount: deposit.method === 'EMI_3_MONTHS' ? 3 : 1,
            installmentAmount:
              deposit.method === 'EMI_3_MONTHS'
                ? (Number(deposit.installmentAmount) > 0
                    ? Number(deposit.installmentAmount)
                    : money(additional / 3))
                : additional,
          },
          include: { transactions: true },
        });
      } else if (additional > 0) {
        deposit = await this.prisma.securityDeposit.create({
          data: {
            payrollRunId: runId,
            employeeId: emp.id,
            triggerReason: held > 0 ? 'SALARY_INCREMENT_TOP_UP' : 'NEW_EMPLOYEE',
            previousSalary: emp.salaryHistory[1] ? Number(emp.salaryHistory[1].grossSalary) : 0,
            currentSalary: gross,
            requiredDeposit,
            alreadyHeld: held,
            additionalRequired: additional,
            method: 'FULL',
            installmentCount: 1,
            installmentAmount: additional,
            status: 'ACTIVE',
          },
          include: { transactions: true },
        });
      }

      // Security deposit is intentionally 0 until HR/CEO explicitly chooses FULL or EMI.
      // Once a method has been selected in this run, preserve that selected installment.
      let securityDeposit = existingResult ? Number(existingResult.securityDeposit) : 0;
      if (existingResult && deposit && Number(existingResult.securityDeposit) > 0 && Number(deposit.additionalRequired) <= 0) {
        securityDeposit = 0;
      }

      const otherDeductions = existingResult ? Number(existingResult.otherDeductions) : 0;
      const payable = money(Math.max(0, gross - attendanceDeduction - penalty - ptax - securityDeposit - otherDeductions));
      const existingSnapshot: any = existingResult?.ruleSnapshot && typeof existingResult.ruleSnapshot === 'object'
        ? existingResult.ruleSnapshot
        : {};
      const manualOverrides = existingSnapshot.manualOverrides ?? {};
      const calculationTrace = {
        grossSalary: gross,
        dailySalary: money(dailySalary),
        leaveUsed,
        paidLeaveAllowance: rules.paid_leave_allowance,
        excessLeaveDeduction,
        lateMarks,
        lateLeaveDeduction,
        doubleDeductionLeave,
        totalDeductionLeave,
        attendanceDeduction,
        penalty,
        ptax,
        securityDeposit,
        otherDeductions,
        payable,
      };

      await this.prisma.payrollResult.upsert({
        where: { payrollRunId_employeeId: { payrollRunId: runId, employeeId: emp.id } },
        update: { grossSalary: gross, calendarDays, weekOffDays, holidayDays, paidLeaveAllowance: rules.paid_leave_allowance, stwiLeaveDays: leaveUsed, lateMarks, lateLeaveDeduction, excessLeaveDeduction, doubleDeductionLeave, penalty, securityDeposit, ptax, otherDeductions, payableAmount: payable, ruleSnapshot: { ...rules, calculationTrace, manualOverrides } },
        create: { payrollRunId: runId, employeeId: emp.id, grossSalary: gross, calendarDays, weekOffDays, holidayDays, paidLeaveAllowance: rules.paid_leave_allowance, stwiLeaveDays: leaveUsed, lateMarks, lateLeaveDeduction, excessLeaveDeduction, doubleDeductionLeave, penalty, securityDeposit, ptax, otherDeductions, payableAmount: payable, ruleSnapshot: { ...rules, calculationTrace, manualOverrides } },
      });
    }

    await this.audit.log({ userId, action: 'CALCULATE', entityType: 'PayrollRun', entityId: runId, afterJson: { rules } });
    return this.prisma.payrollResult.findMany({ where: { payrollRunId: runId }, include: { employee: true }, orderBy: { employee: { name: 'asc' } } });
  }

  async payroll(runId: string, query: { page?: string; pageSize?: string; employeeId?: string; search?: string; hasLate?: string; hasLeave?: string; hasPenalty?: string; hasPtax?: string; hasSecurityDeposit?: string; minGross?: string; maxGross?: string; minPayable?: string; maxPayable?: string }) {
    const { page, pageSize, skip } = parsePagination(query.page, query.pageSize);
    const flags = {
      late: parseBoolean(query.hasLate),
      leave: parseBoolean(query.hasLeave),
      penalty: parseBoolean(query.hasPenalty),
      ptax: parseBoolean(query.hasPtax),
      deposit: parseBoolean(query.hasSecurityDeposit),
    };
    const decimalRange = (min?: string, max?: string) => {
      const out: any = {};
      if (min !== undefined && min !== '' && Number.isFinite(Number(min))) out.gte = Number(min);
      if (max !== undefined && max !== '' && Number.isFinite(Number(max))) out.lte = Number(max);
      return Object.keys(out).length ? out : undefined;
    };
     const employeeId = query.employeeId?.trim() || undefined;
    const search = query.search?.trim();
    const where: any = {
      payrollRunId: runId,
       ...(employeeId ? { employeeId: employeeId } : {}),
      ...(flags.late !== undefined ? { lateMarks: flags.late ? { gt: 0 } : { equals: 0 } } : {}),
      ...(flags.leave !== undefined ? { OR: flags.leave ? [{ stwiLeaveDays: { gt: 0 } }, { excessLeaveDeduction: { gt: 0 } }, { doubleDeductionLeave: { gt: 0 } }] : [{ stwiLeaveDays: { equals: 0 } }, { excessLeaveDeduction: { equals: 0 }, doubleDeductionLeave: { equals: 0 } }] } : {}),
      ...(flags.penalty !== undefined ? { penalty: flags.penalty ? { gt: 0 } : { equals: 0 } } : {}),
      ...(flags.ptax !== undefined ? { ptax: flags.ptax ? { gt: 0 } : { equals: 0 } } : {}),
      ...(flags.deposit !== undefined ? { securityDeposit: flags.deposit ? { gt: 0 } : { equals: 0 } } : {}),
      ...(decimalRange(query.minGross, query.maxGross) ? { grossSalary: decimalRange(query.minGross, query.maxGross) } : {}),
      ...(decimalRange(query.minPayable, query.maxPayable) ? { payableAmount: decimalRange(query.minPayable, query.maxPayable) } : {}),
      ...(search ? { employee: { OR: [{ name: { contains: search } }, { employeeCode: { contains: search } }] } } : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.payrollResult.findMany({ where, include: { employee: true }, orderBy: { employee: { name: 'asc' } }, skip, take: pageSize }),
      this.prisma.payrollResult.count({ where }),
    ]);

    const ids = data.map((r) => r.employeeId);
    const attendanceRows = ids.length
      ? await this.prisma.attendanceRecord.findMany({ where: { payrollRunId: runId, employeeId: { in: ids } }, select: { employeeId: true, status: true, leaveFraction: true } })
      : [];
    const byEmployee = new Map<string, any>();
    for (const row of attendanceRows) {
      const current = byEmployee.get(row.employeeId) ?? { halfDayCount: 0 };
      if (row.status === 'HALF_DAY' || Number(row.leaveFraction ?? 0) === 0.5) current.halfDayCount += 1;
      byEmployee.set(row.employeeId, current);
    }

    const enriched = data.map((r) => {
      const snapshot: any = r.ruleSnapshot && typeof r.ruleSnapshot === 'object' ? r.ruleSnapshot : {};
      const trace: any = snapshot.calculationTrace;
      const overrides: any = snapshot.manualOverrides ?? {};
      const dailySalary = Number(overrides.dailySalary ?? trace?.dailySalary ?? Number(r.grossSalary) / Math.max(1, Number(r.calendarDays)));
      const deductionLeave = Number(r.lateLeaveDeduction) + Number(r.excessLeaveDeduction) + Number(r.doubleDeductionLeave);
      const leaveDeductionAmount = Number(overrides.leaveDeductionAmount ?? money(dailySalary * deductionLeave));
      const heldSecurityDeposit = Number(overrides.heldSecurityDeposit ?? Number(r.securityDeposit));
      return {
        ...r,
        workingDays: Number(overrides.workingDays ?? (Number(r.calendarDays) - Number(r.weekOffDays) - Number(r.holidayDays))),
        dailySalary,
        leaveDeductionAmount,
        halfDayCount: Number(overrides.halfDayCount ?? (byEmployee.get(r.employeeId)?.halfDayCount ?? 0)),
        totalLeave: Number(overrides.totalLeave ?? (Number(r.stwiLeaveDays) + Number(r.lateLeaveDeduction))),
        heldSecurityDeposit,
        renewalDate: overrides.renewalDate ?? null,
        joiningDate: overrides.joinDate ?? r.employee.joiningDate,
      };
    });
    return paged(enriched, total, page, pageSize);
  }

  async updatePayrollResult(userId: string, runId: string, employeeId: string, body: any) {
    const run = await this.prisma.payrollRun.findUnique({ where: { id: runId } });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (run.status === 'FINALIZED') throw new BadRequestException('Finalized run is locked');

    const result = await this.prisma.payrollResult.findUnique({
      where: { payrollRunId_employeeId: { payrollRunId: runId, employeeId } },
    });
    if (!result) throw new NotFoundException('Payroll result not found');

    const numericFields = [
      'grossSalary', 'calendarDays', 'weekOffDays', 'holidayDays', 'paidLeaveAllowance',
      'stwiLeaveDays', 'lateMarks', 'lateLeaveDeduction', 'excessLeaveDeduction',
      'doubleDeductionLeave', 'penalty', 'securityDeposit', 'ptax', 'otherDeductions',
      'payableAmount',
    ] as const;
    const data: any = {};
    for (const field of numericFields) {
      if (body[field] === undefined || body[field] === null || body[field] === '') continue;
      const n = Number(body[field]);
      if (!Number.isFinite(n)) throw new BadRequestException(`Invalid numeric value for ${field}`);
      data[field] = field === 'calendarDays' || field === 'lateMarks' ? Math.max(0, Math.round(n)) : Math.max(0, money(n));
    }

    const snapshot: any = result.ruleSnapshot && typeof result.ruleSnapshot === 'object' ? result.ruleSnapshot : {};
    const manualOverrides = { ...(snapshot.manualOverrides ?? {}) };
    for (const field of ['workingDays', 'dailySalary', 'leaveDeductionAmount', 'totalLeave', 'heldSecurityDeposit', 'renewalDate', 'halfDayCount', 'details', 'joinDate']) {
      if (body[field] !== undefined) manualOverrides[field] = body[field];
    }
    data.ruleSnapshot = { ...snapshot, manualOverrides, calculationTrace: snapshot.calculationTrace ?? {} };

    // When the user edits deduction inputs but leaves payable blank, recalculate it.
    if (body.payableAmount === undefined) {
      const gross = Number(data.grossSalary ?? result.grossSalary);
      const daily = Number(manualOverrides.dailySalary ?? (gross / Math.max(1, Number(data.calendarDays ?? result.calendarDays))));
      const leaveDeduction = Number(data.lateLeaveDeduction ?? result.lateLeaveDeduction)
        + Number(data.excessLeaveDeduction ?? result.excessLeaveDeduction)
        + Number(data.doubleDeductionLeave ?? result.doubleDeductionLeave);
      const leaveAmount = Number(manualOverrides.leaveDeductionAmount ?? (daily * leaveDeduction));
      data.payableAmount = money(Math.max(0, gross - leaveAmount - Number(data.penalty ?? result.penalty) - Number(data.ptax ?? result.ptax) - Number(data.securityDeposit ?? result.securityDeposit) - Number(data.otherDeductions ?? result.otherDeductions)));
    }

    const updated = await this.prisma.payrollResult.update({ where: { id: result.id }, data });
    await this.audit.log({
      userId, employeeId, action: 'EDIT_PAYROLL_RESULT', entityType: 'PayrollResult', entityId: result.id,
      beforeJson: result, afterJson: updated,
    });
    return updated;
  }

  async setOtherDeduction(userId: string, runId: string, employeeId: string, amount: number) {
    const run =
  await this.prisma.payrollRun.findUnique({
    where: { id: runId },
  });

if (!run) {
  throw new NotFoundException(
    'Payroll run not found',
  );
}

if (run.status === 'FINALIZED') {
  throw new BadRequestException(
    'Finalized run is locked',
  );
}
    const result = await this.prisma.payrollResult.findUnique({ where: { payrollRunId_employeeId: { payrollRunId: runId, employeeId } } });
    if (!result) throw new NotFoundException('Payroll result not found');
    const normalized = money(Math.max(0, Number(amount) || 0));
const daily =
  Number(result.grossSalary) /
  Math.max(1, Number(result.calendarDays));
      const attendanceDeduction = daily * (Number(result.lateLeaveDeduction) + Number(result.excessLeaveDeduction) + Number(result.doubleDeductionLeave));
    const payableAmount = money(Math.max(0, Number(result.grossSalary) - attendanceDeduction - Number(result.penalty) - Number(result.ptax) - Number(result.securityDeposit) - normalized));
    const updated = await this.prisma.payrollResult.update({ where: { id: result.id }, data: { otherDeductions: normalized, payableAmount } });
    await this.audit.log({ userId, employeeId, action: 'SET_OTHER_DEDUCTION', entityType: 'PayrollResult', entityId: result.id, afterJson: { amount: normalized } });
    return updated;
  }

async setDepositMethod(
    userId: string,
    runId: string,
    employeeId: string,
    method: 'FULL' | 'EMI_3_MONTHS',
  ): Promise<any> {
    const run =
  await this.prisma.payrollRun.findUnique({
    where: { id: runId },
  });

if (!run) {
  throw new NotFoundException(
    'Payroll run not found',
  );
}

if (run.status === 'FINALIZED') {
  throw new BadRequestException(
    'Finalized run is locked',
  );
}
    let result = await this.prisma.payrollResult.findUnique({ where: { payrollRunId_employeeId: { payrollRunId: runId, employeeId } } });
    if (!result) {
      await this.calculatePayroll(runId, userId);
      result = await this.prisma.payrollResult.findUnique({ where: { payrollRunId_employeeId: { payrollRunId: runId, employeeId } } });
    }
    if (!result) throw new NotFoundException('Payroll result not found');

    const deposit = await this.prisma.securityDeposit.findFirst({ where: { employeeId, status: 'ACTIVE' }, orderBy: { createdAt: 'desc' }, include: { transactions: true } });
    if (!deposit) {
      return result;
    }

    const remaining = Math.max(0, Number(deposit.additionalRequired));
    if (remaining <= 0) {
      const updated = await this.prisma.payrollResult.update({ where: { id: result.id }, data: { securityDeposit: 0 } });
      return updated;
    }

    const installmentCount = method === 'FULL' ? 1 : 3;
    const installmentAmount = method === 'FULL' ? remaining : money(remaining / installmentCount);
    await this.prisma.securityDeposit.update({ where: { id: deposit.id }, data: { method, installmentCount, installmentAmount } });

    const otherDeductions = Number(result.otherDeductions);
const daily =
  Number(result.grossSalary) /
  Math.max(1, Number(result.calendarDays));
      const attendanceDeduction = daily * (Number(result.lateLeaveDeduction) + Number(result.excessLeaveDeduction) + Number(result.doubleDeductionLeave));
    const newPayable = money(Math.max(0, Number(result.grossSalary) - attendanceDeduction - Number(result.penalty) - Number(result.ptax) - otherDeductions - installmentAmount));
    const updated = await this.prisma.payrollResult.update({ where: { id: result.id }, data: { securityDeposit: installmentAmount, payableAmount: newPayable } });
    await this.audit.log({ userId, employeeId, action: 'SET_SECURITY_DEPOSIT_METHOD', entityType: 'PayrollResult', entityId: result.id, afterJson: { method, installmentAmount } });
    return updated;
  }

  async finalize(userId: string, runId: string) {
    const run = await this.prisma.payrollRun.findUnique({ where: { id: runId } });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (run.status === 'FINALIZED') return run;
    const open = await this.prisma.manualReview.count({ where: { payrollRunId: runId, status: 'OPEN' } });
    if (open) throw new BadRequestException(`Resolve ${open} open manual review(s) before finalization.`);

    await this.calculatePayroll(runId, userId);
    const results = await this.prisma.payrollResult.findMany({ where: { payrollRunId: runId } });

    for (const result of results) {
      const deposit = await this.prisma.securityDeposit.findFirst({ where: { employeeId: result.employeeId, status: 'ACTIVE' }, include: { transactions: true }, orderBy: { createdAt: 'desc' } });
      if (deposit && Number(deposit.additionalRequired) > 0 && Number(result.securityDeposit) <= 0) {
        throw new BadRequestException(`Select a security deposit method for ${result.employeeId} before finalization.`);
      }
    }

    for (const result of results) {
      const deposit = await this.prisma.securityDeposit.findFirst({ where: { employeeId: result.employeeId, status: 'ACTIVE' }, include: { transactions: true }, orderBy: { createdAt: 'desc' } });
      if (!deposit || Number(result.securityDeposit) <= 0) continue;
      const already = deposit.transactions.some(t => t.payrollRunId === runId);
      if (already) continue;
      const installmentNumber = deposit.transactions.length + 1;
      const amount = Math.min(Number(deposit.installmentAmount), Number(deposit.additionalRequired));
      await this.prisma.securityDepositTransaction.create({ data: { employeeId: result.employeeId, securityDepositId: deposit.id, payrollRunId: runId, installmentNumber, amount, transactionDate: new Date(), note: `Payroll ${run.month}/${run.year} security deposit deduction` } });
      const remainingAfter = Math.max(0, Number(deposit.additionalRequired) - amount);
      if (installmentNumber >= deposit.installmentCount || remainingAfter <= 0.01) {
        await this.prisma.securityDeposit.update({ where: { id: deposit.id }, data: { status: 'COMPLETED', completedAt: new Date(), alreadyHeld: Number(deposit.alreadyHeld) + amount, additionalRequired: 0 } });
      } else {
        await this.prisma.securityDeposit.update({ where: { id: deposit.id }, data: { alreadyHeld: Number(deposit.alreadyHeld) + amount, additionalRequired: remainingAfter } });
      }
    }

    const finalRun = await this.prisma.payrollRun.update({ where: { id: runId }, data: { status: 'FINALIZED', finalizedAt: new Date() } });
    await this.audit.log({ userId, action: 'FINALIZE', entityType: 'PayrollRun', entityId: runId });
    return finalRun;
  }

  async reopen(userId: string, runId: string) {
    const run = await this.prisma.payrollRun.findUnique({ where: { id: runId } });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (run.status !== 'FINALIZED') return run;
    const updated = await this.prisma.payrollRun.update({ where: { id: runId }, data: { status: 'REOPENED', reopenedAt: new Date() } });
    await this.audit.log({ userId, action: 'REOPEN', entityType: 'PayrollRun', entityId: runId });
    return updated;
  }

  async attendanceSummary(runId: string) {
    const run = await this.prisma.payrollRun.findUnique({ where: { id: runId } });
    if (!run) throw new NotFoundException('Payroll run not found');

    const records = await this.prisma.attendanceRecord.findMany({
      where: { payrollRunId: runId },
      include: { employee: true },
      orderBy: [{ employee: { name: 'asc' } }, { workDate: 'asc' }],
    });

    const byEmployee = new Map<string, any>();
    for (const record of records) {
      if (!byEmployee.has(record.employeeId)) {
        byEmployee.set(record.employeeId, {
          employeeId: record.employeeId,
          employeeCode: record.employee.employeeCode,
          employeeName: record.employee.name,
          lateMarks: [],
          leaves: [],
        });
      }

      const item = {
        date: dateKey(record.workDate),
        checkIn: record.firstCheckIn ? record.firstCheckIn.toISOString() : null,
        lateMinutes: record.lateMinutes,
        status: record.status,
        sourceStatus: record.sourceStatus,
        leaveFraction: Number(record.leaveFraction ?? 0),
      };

      const employee = byEmployee.get(record.employeeId);
      if (record.isLate) employee.lateMarks.push(item);
      if (Number(record.leaveFraction ?? 0) > 0) employee.leaves.push(item);
    }

    const employees = Array.from(byEmployee.values()).map((employee: any) => ({
      ...employee,
      lateMarkCount: employee.lateMarks.length,
      leaveDays: money(employee.leaves.reduce((sum: number, row: any) => sum + Number(row.leaveFraction || 0), 0)),
    }));

    return {
      runId,
      year: run.year,
      month: run.month,
      totals: {
        lateMarkCount: employees.reduce((sum, e) => sum + e.lateMarkCount, 0),
        leaveDays: money(employees.reduce((sum, e) => sum + e.leaveDays, 0)),
      },
      employees,
    };
  }

  async attendance(runId: string, query: { page?: string; pageSize?: string; employeeId?: string; search?: string; status?: string; late?: string; leave?: string; holiday?: string; weekOff?: string; manualReview?: string; dateFrom?: string; dateTo?: string }) {
    const { page, pageSize, skip } = parsePagination(query.page, query.pageSize);
    const late = parseBoolean(query.late);
    const leave = parseBoolean(query.leave);
    const holiday = parseBoolean(query.holiday);
    const weekOff = parseBoolean(query.weekOff);
    const manualReview = parseBoolean(query.manualReview);
    const search = query.search?.trim();
    const workDate: any = {};
    if (query.dateFrom) { const d = new Date(`${query.dateFrom}T00:00:00.000Z`); if (!Number.isNaN(d.getTime())) workDate.gte = d; }
    if (query.dateTo) { const d = new Date(`${query.dateTo}T23:59:59.999Z`); if (!Number.isNaN(d.getTime())) workDate.lte = d; }
    const where: any = {
      payrollRunId: runId,
      ...(query.employeeId ? { employeeId: query.employeeId } : {}),
      ...(query.status ? { status: query.status as any } : {}),
      ...(late !== undefined ? { isLate: late } : {}),
      ...(leave !== undefined ? { leaveFraction: leave ? { gt: 0 } : { equals: 0 } } : {}),
      ...(holiday !== undefined ? { isHoliday: holiday } : {}),
      ...(weekOff !== undefined ? { isWeekOff: weekOff } : {}),
      ...(Object.keys(workDate).length ? { workDate } : {}),
      ...(search ? { employee: { OR: [{ name: { contains: search } }, { employeeCode: { contains: search } }] } } : {}),
      ...(manualReview ? { status: 'MANUAL_REVIEW' } : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.attendanceRecord.findMany({ where, include: { employee: true, leaveEvent: true }, orderBy: [{ workDate: 'asc' }, { employee: { name: 'asc' } }], skip, take: pageSize }),
      this.prisma.attendanceRecord.count({ where }),
    ]);
    return paged(data, total, page, pageSize);
  }

  private async ruleNumber(key: string, fallback: number) { const r = await this.prisma.ruleDefinition.findFirst({ where: { key, effectiveTo: null }, orderBy: { effectiveFrom: 'desc' } }); const n = Number(r?.value); return Number.isFinite(n) ? n : fallback; }
  private async rulesSnapshot(year: number, month: number) {
    const storedPtaxThreshold = await this.ruleNumber('ptax_threshold', 12000);
    // 15000 was the old legacy seed value; the confirmed STWI rule is now
    // > ₹12,000. Preserve explicit non-legacy changes, but automatically
    // interpret the old seed as the new confirmed threshold.
    const ptaxThreshold = storedPtaxThreshold === 15000 ? 12000 : storedPtaxThreshold;

    return {
      paid_leave_allowance: await this.ruleNumber('paid_leave_allowance', 1.5),
      late_mark_threshold: await this.ruleNumber('late_mark_threshold', 3),
      leave_per_threshold: await this.ruleNumber('leave_per_threshold', 1),
      normal_login: (await this.prisma.ruleDefinition.findFirst({ where: { key: 'normal_login', effectiveTo: null }, orderBy: { effectiveFrom: 'desc' } }))?.value ?? '09:30',
      first_half_login: (await this.prisma.ruleDefinition.findFirst({ where: { key: 'first_half_login', effectiveTo: null }, orderBy: { effectiveFrom: 'desc' } }))?.value ?? '14:30',
      ptax_threshold: ptaxThreshold,
      ptax_amount: await this.ruleNumber('ptax_amount', 200),
      full_day_min_hours: await this.ruleNumber('full_day_min_hours', 8),
      half_day_min_hours: await this.ruleNumber('half_day_min_hours', 4),
      half_day_max_hours: await this.ruleNumber('half_day_max_hours', 5.5),
      double_deduction_leave_days: await this.ruleNumber('double_deduction_leave_days', 1),
      daily_salary_divisor: null,
      year, month,
    };
  }

  async exportWorkbook(runId: string) {
    const run = await this.get(runId);
    const attendance = await this.prisma.attendanceRecord.findMany({
      where: { payrollRunId: runId },
      include: { employee: true, leaveEvent: true },
      orderBy: [{ workDate: 'asc' }, { employee: { name: 'asc' } }],
    });
    const payroll = await this.prisma.payrollResult.findMany({
      where: { payrollRunId: runId },
      include: { employee: true },
      orderBy: { employee: { name: 'asc' } },
    });
    const reviews = await this.prisma.manualReview.findMany({
      where: { payrollRunId: runId },
      include: { employee: true },
      orderBy: { createdAt: 'desc' },
    });
    const transactions = await this.prisma.securityDepositTransaction.findMany({ where: { employeeId: { in: payroll.map(r => r.employeeId) } } });
    const heldByEmployee = new Map<string, number>();
    for (const tx of transactions) heldByEmployee.set(tx.employeeId, (heldByEmployee.get(tx.employeeId) || 0) + Number(tx.amount));

    const wb = new ExcelJS.Workbook();
    wb.creator = 'STWI Attendance & Payroll';

    // Keep the first sheet compatible with the existing August Payment Sheet structure.
    const paySheet = wb.addWorksheet('Payment Sheet');
    paySheet.addRow(['','Name','Working Day','Monthly Payment','SD Dudcation Month','Security Deposit','Leave','Pently','P.Tax','Payable AMT','DeductionLeave','Half Day','Late Mark','Paid Leave','Double Deduction Leave','Total Leave','Join Date','Renewal Date','Deposit','Details Decripations']);
    for (let index = 0; index < payroll.length; index++) {
      const r = payroll[index];
      const records = attendance.filter(a => a.employeeId === r.employeeId);
      const halfDays = records.reduce((sum, a) => sum + (a.status === 'HALF_DAY' || Number(a.leaveFraction ?? 0) === 0.5 ? 0.5 : 0), 0);
      const leaveUsed = Number(r.stwiLeaveDays);
      const deductionLeave = Number(r.lateLeaveDeduction) + Number(r.excessLeaveDeduction) + Number(r.doubleDeductionLeave);
      const workingDays = r.calendarDays - Number(r.weekOffDays) - Number(r.holidayDays);
      const snap = (r.ruleSnapshot as any) || {};
      const trace = snap.calculationTrace;
      const overrides = snap.manualOverrides || {};
      paySheet.addRow([
        index + 1,
        r.employee.name,
        Number(overrides.workingDays ?? workingDays),
        Number(overrides.grossSalary ?? r.grossSalary),
        Number(r.securityDeposit),
        Number(r.securityDeposit),
        Number(overrides.leaveDeductionAmount ?? money((Number(r.grossSalary) / Math.max(1, Number(r.calendarDays))) * deductionLeave)),
        Number(r.penalty),
        Number(r.ptax),
        Number(r.payableAmount),
        deductionLeave,
        halfDays,
        r.lateMarks,
        Number(r.paidLeaveAllowance),
        Number(r.doubleDeductionLeave),
        leaveUsed + Number(r.lateLeaveDeduction),
        r.employee.joiningDate ?? '',
        '',
        heldByEmployee.get(r.employeeId) || 0,
        trace ? JSON.stringify(trace) : '',
      ]);
    }
    this.styleHeader(paySheet, 1);
    for (const cell of ['D','E','F','G','H','I','J','S']) paySheet.getColumn(cell).numFmt = '₹#,##0.00';
    paySheet.getColumn('Q').numFmt = 'dd-mmm-yyyy';

    const emailSheet = wb.addWorksheet('email summary');
    emailSheet.addRow(['Employee ID','Employee Name','Email','Gross Salary','Payable Amount','Run Month']);
    for (const r of payroll) emailSheet.addRow([r.employee.employeeCode, r.employee.name, r.employee.email ?? '', Number(r.grossSalary), Number(r.payableAmount), `${run.month}/${run.year}`]);
    this.styleHeader(emailSheet, 1);
    emailSheet.getColumn('D').numFmt = '₹#,##0.00'; emailSheet.getColumn('E').numFmt = '₹#,##0.00';

    const reviewSheet = wb.addWorksheet('Manual Review');
    reviewSheet.addRow(['Status','Type','Employee ID','Employee','Description','Resolution','Penalty','Double Deduction Leave','Created At','Resolved At']);
    for (const r of reviews) reviewSheet.addRow([r.status,r.type,r.employee?.employeeCode ?? '',r.employee?.name ?? '',r.description,r.resolution ?? '',Number(r.penaltyAmount ?? 0),r.doubleDeductionLeave,r.createdAt,r.resolvedAt ?? '']);
    this.styleHeader(reviewSheet, 1);

    const traceSheet = wb.addWorksheet('Calculation Trace');
    traceSheet.addRow(['Employee ID','Employee','Gross Salary','Daily Salary','Leave Used','Paid Leave','Excess Leave','Late Marks','Late Leave','Double Deduction','Total Deduction Leave','Attendance Deduction','Penalty','P.Tax','Security Deposit','Other Deduction','Payable']);
    for (const r of payroll) {
      const trace = (r.ruleSnapshot as any)?.calculationTrace || {};
      traceSheet.addRow([r.employee.employeeCode,r.employee.name,Number(r.grossSalary),Number(trace.dailySalary || Number(r.grossSalary)/Math.max(1, Number(r.calendarDays))),Number(trace.leaveUsed || r.stwiLeaveDays),Number(trace.paidLeaveAllowance || r.paidLeaveAllowance),Number(trace.excessLeaveDeduction || r.excessLeaveDeduction),r.lateMarks,Number(trace.lateLeaveDeduction || r.lateLeaveDeduction),Number(trace.doubleDeductionLeave || r.doubleDeductionLeave),Number(trace.totalDeductionLeave || (Number(r.lateLeaveDeduction)+Number(r.excessLeaveDeduction)+Number(r.doubleDeductionLeave))),Number(trace.attendanceDeduction || 0),Number(r.penalty),Number(r.ptax),Number(r.securityDeposit),Number(r.otherDeductions),Number(r.payableAmount)]);
    }
    this.styleHeader(traceSheet, 1);
    for (const cell of ['C','D','L','M','N','O','P','Q']) traceSheet.getColumn(cell).numFmt = '₹#,##0.00';

    const byEmp = new Map<string, any[]>();
    for (const r of attendance) { const code = r.employee.employeeCode; if (!byEmp.has(code)) byEmp.set(code, []); byEmp.get(code)!.push(r); }
    for (const [code, rows] of byEmp) {
      const ws = wb.addWorksheet(code.slice(0,31));
      ws.addRow(['Date','First Check-In','Last Check-Out','Worked Hours','Source Status','Status','Late','Late Minutes','Leave Fraction','Holiday','Week Off']);
      for (const r of rows) ws.addRow([r.workDate, r.firstCheckIn ?? '', r.lastCheckOut ?? '', r.workedHours == null ? '' : Number(r.workedHours), r.sourceStatus ?? '', r.status, r.isLate, r.lateMinutes, r.leaveFraction == null ? '' : Number(r.leaveFraction), r.isHoliday, r.isWeekOff]);
      this.styleHeader(ws, 1); ws.getColumn(1).numFmt = 'dd-mm-yyyy';
    }
    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  private styleHeader(ws: ExcelJS.Worksheet, row: number) { const r = ws.getRow(row); r.font = { bold: true }; r.alignment = { vertical: 'middle' }; r.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1F4E78' } }; c.font = { color: { argb: 'FFFFFF' }, bold: true }; }); ws.views = [{ state: 'frozen', ySplit: 1 }]; ws.columns.forEach(c => { c.width = Math.min(Math.max((c.header?.toString().length || 12) + 3, 12), 32); }); }

  async resetDepositMethod(
  userId: string,
  runId: string,
  employeeId: string,
): Promise<any> {
  const run = await this.prisma.payrollRun.findUnique({
    where: { id: runId },
  });

  if (!run) {
    throw new NotFoundException('Payroll run not found');
  }

  if (run.status === 'FINALIZED') {
    throw new BadRequestException(
      'Finalized run cannot be changed.',
    );
  }

  const result =
    await this.prisma.payrollResult.findUnique({
      where: {
        payrollRunId_employeeId: {
          payrollRunId: runId,
          employeeId,
        },
      },
    });

  if (!result) {
    throw new NotFoundException(
      'Payroll result not found',
    );
  }

  const deposit =
    await this.prisma.securityDeposit.findFirst({
      where: {
        employeeId,
        status: 'ACTIVE',
      },
      include: {
        transactions: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

  if (!deposit) {
    return result;
  }

  const alreadyFinalized =
    deposit.transactions.some(
      (t) => t.payrollRunId === runId,
    );

  if (alreadyFinalized) {
    throw new BadRequestException(
      'This deposit has already been finalized for the run and cannot be undone.',
    );
  }

  const daily =
    Number(result.grossSalary) /
    Math.max(1, Number(result.calendarDays));

  const attendanceDeduction =
    daily *
    (
      Number(result.lateLeaveDeduction) +
      Number(result.excessLeaveDeduction) +
      Number(result.doubleDeductionLeave)
    );

  const payableAmount = money(
    Math.max(
      0,
      Number(result.grossSalary) -
        attendanceDeduction -
        Number(result.penalty) -
        Number(result.ptax) -
        Number(result.otherDeductions),
    ),
  );

  const updated =
    await this.prisma.payrollResult.update({
      where: { id: result.id },
      data: {
        securityDeposit: 0,
        payableAmount,
      },
    });

  await this.audit.log({
    userId,
    employeeId,
    action: 'RESET_SECURITY_DEPOSIT_METHOD',
    entityType: 'PayrollResult',
    entityId: result.id,
    afterJson: {
      securityDeposit: 0,
    },
  });

  return updated;
}

}
