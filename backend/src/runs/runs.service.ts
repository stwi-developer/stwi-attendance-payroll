import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import * as XLSX from 'xlsx';
import * as ExcelJS from 'exceljs';
import { codeKey } from '../utils/employee-code';
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


// ---------------------------------------------------------------------------
// V1.7 attendance rules (confirmed by STWI on 23-Sep-2026)
//
//  Q1  "0.5 day Present, 0.5 day Absent" under the full-day hours (8h)
//      -> Manual Review (UNEXPECTED_DURATION), NO automatic leave; the day
//         still gets a late mark when check-in is after the expected login.
//      At 8h or more it stays an automatic 0.5-day leave (e.g. overnight
//      checkout such as Dixit 17-Aug).
//  Q2  Zoho status exactly "Absent" -> always 1 full day of leave,
//      whatever hours were recorded.
//  Q3  No late mark on a Zoho "Absent" day.
//  Q4  Short hours on any other working day (under 8h, or under 4h for a
//      half-day STWI leave) -> Manual Review (UNEXPECTED_DURATION); HR
//      checks the status and decides the leave. No automatic shortfall leave.
//  Q5a Check-in but no check-out -> Manual Review (MISSING_CHECKOUT).
//      When Zoho marks the day "Absent" it stays 1 day of leave (Q2) until
//      HR decides otherwise in the review.
//  Unchanged: "... / Regularized" = PRESENT, no leave, no review;
//      weekends/holidays exempt; full-day STWI leave = 1 day, no late;
//      missing check-in on a working day -> Manual Review.
// ---------------------------------------------------------------------------
type ReviewKind = 'MISSING_CHECKIN' | 'MISSING_CHECKOUT' | 'AMBIGUOUS_LEAVE' | 'UNEXPECTED_DURATION';
export type AttendanceDecision = {
  status: any;
  leaveFraction: number;
  leaveType: string;
  late: boolean;
  lateMinutes: number;
  holiday: boolean;
  weekend: boolean;
  reviewType: ReviewKind | null;
  reviewReason: string;
};

export function classifyAttendanceRow(
  row: { status: string; totalHours: number | null; firstCheckIn: Date | null; firstCheckInMinutes: number | null; lastCheckOut: Date | null },
  workDate: Date,
  cfg: { minHalf: number; maxHalf: number; fullDayHours: number },
): AttendanceDecision {
  const holiday = row.status.toLowerCase().includes('holiday');
  const weekend = isWeekendDay(workDate);
  const normalized = normalizeAttendanceStatus(row.status);
  const shortHoursAction = getShortHoursStatusAction(row.status);
  const classification = leaveClassification(row.status, row.totalHours, cfg.minHalf, cfg.maxHalf);
  const hours = row.totalHours;
  const hasCheckIn = Boolean(row.firstCheckIn);
  const firstMin = row.firstCheckInMinutes ?? timeMinutes(row.firstCheckIn);

  const d: AttendanceDecision = {
    status: holiday ? 'HOLIDAY' : weekend ? 'WEEK_OFF' : 'PRESENT',
    leaveFraction: 0,
    leaveType: 'HALF_DAY',
    late: false,
    lateMinutes: 0,
    holiday,
    weekend,
    reviewType: null,
    reviewReason: '',
  };

  // Weekends and holidays: no leave, no late mark, no review.
  if (holiday || weekend) return d;

  // Q2 + Q3 + Q5a: explicit Zoho "Absent".
  if (normalized === 'absent') {
    d.status = 'ABSENT';
    d.leaveFraction = 1;
    d.leaveType = 'ABSENT';
    if (hasCheckIn && !row.lastCheckOut) {
      d.reviewType = 'MISSING_CHECKOUT';
      d.reviewReason = 'Checked in but no check-out (Zoho: Absent, counted as 1 day leave unless HR decides otherwise)';
    }
    return d;
  }

  if (shortHoursAction === 'REGULARIZED_PRESENT') {
    // Handover rule 24: always PRESENT, no leave, no review.
    d.status = 'PRESENT';
  } else if (shortHoursAction === 'MANUAL_REVIEW') {
    // Q1: generic Zoho half-day.
    if (hours == null || hours < cfg.fullDayHours) {
      d.status = 'MANUAL_REVIEW';
      d.reviewType = 'UNEXPECTED_DURATION';
      d.reviewReason = `Zoho half-day under ${formatHours(cfg.fullDayHours)} hours - decide leave`;
    } else {
      d.status = 'HALF_DAY';
      d.leaveFraction = 0.5;
    }
  } else {
    if (classification.type === 'full') {
      d.status = 'STWI_LEAVE';
      d.leaveFraction = 1;
      d.leaveType = 'FULL_DAY';
    } else if (classification.fraction === 0.5) {
      d.status = 'HALF_DAY';
      d.leaveFraction = 0.5;
    }
    if (classification.manual) {
      d.status = 'MANUAL_REVIEW';
      d.reviewType = 'AMBIGUOUS_LEAVE';
      d.reviewReason = 'Ambiguous STWI leave - decide leave';
    } else if (classification.type !== 'full' && hasCheckIn) {
      // Q4: short hours -> review instead of automatic shortfall leave.
      const halfDayCase = ['half_day', 'first_half', 'second_half'].includes(classification.type);
      const required = halfDayCase ? cfg.minHalf : cfg.fullDayHours;
      if (hours != null && hours < required) {
        d.status = 'MANUAL_REVIEW';
        d.reviewType = 'UNEXPECTED_DURATION';
        d.reviewReason = `Short hours (needs ${formatHours(required)}) - check status and decide leave`;
      }
    }
  }

  // Missing check-in on a working day (not full-day leave) -> review.
  if (classification.type !== 'full' && !hasCheckIn && shortHoursAction !== 'REGULARIZED_PRESENT') {
    d.status = 'MANUAL_REVIEW';
    d.reviewType = 'MISSING_CHECKIN';
    d.reviewReason = 'No check-in on a working day - decide leave';
  }

  // Late mark (unchanged thresholds: 09:30 / 14:30 for first-half leave).
  const expected = expectedLoginForAttendance(row.status, classification.type, firstMin);
  if (expected && firstMin != null) {
    const [h, m] = expected.split(':').map(Number);
    const expMin = h * 60 + m;
    if (firstMin > expMin) {
      d.late = true;
      d.lateMinutes = Math.round(firstMin - expMin);
    }
  }
  return d;
}

// Last instant of the payroll month (V1.7 fix: previously resolved to the
// 1st of month+2, so later salaries leaked into earlier months).
function monthEnd(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
}

function formatHours(h: number | null | undefined) {
  if (h == null || !Number.isFinite(h)) return 'n/a';
  const total = Math.round(h * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// A per-day leave decision taken in Manual Review is stored in the review
// resolution as "[leave=0.5]" so it can be re-applied after a re-upload.
function parseLeaveDecision(resolution: string | null | undefined): number | null {
  const m = resolution?.match(/\[leave=([0-9.]+)\]/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function statusForLeave(leave: number): any {
  if (leave <= 0) return 'PRESENT';
  if (leave >= 1) return 'ABSENT';
  return 'HALF_DAY';
}

// ---------------------------------------------------------------------------
// V1.7 payroll arithmetic - ONE implementation used by Calculate, Payroll
// Review edits, Other Deduction, Deposit method, Undo, the payroll list and
// the Excel export, so they can never disagree again.
//
//   late-mark leave   = floor(late marks / 3) x 1
//   deducted days     = max(0, leave + late-mark leave - 1.5 paid leave)
//                       + double-deduction leave            (Q6: outside the allowance)
//   daily salary      = gross / calendar days
//   leave deduction   = daily salary x deducted days
//   payable           = gross - leave deduction - penalty - P.Tax
//                       - security deposit - other deductions   (min 0)
//
// Manual Payroll Review edits (Q8) are "overrides" layered on top: any edited
// value replaces the calculated one and everything after it is recalculated,
// unless the payable itself was edited.
// ---------------------------------------------------------------------------
export type PayrollBase = {
  grossSalary: number;
  calendarDays: number;
  leaveUsed: number;
  lateMarks: number;
  paidLeaveAllowance: number;
  doubleDeductionLeave: number;
  penalty: number;
  ptax: number;
  lateMarkThreshold: number;
  leavePerThreshold: number;
  /** V1.9: days of the month before the joining date / after the exit date (not paid) */
  notEmployedDays?: number;
};

const OVERRIDE_NUMERIC_FIELDS = ['grossSalary', 'dailySalary', 'deductionLeave', 'leaveDeductionAmount', 'penalty', 'ptax', 'payableAmount', 'lateMarks', 'paidLeaveAllowance', 'doubleDeductionLeave'] as const;
const OVERRIDE_DISPLAY_NUMERIC_FIELDS = ['workingDays', 'halfDayCount', 'totalLeave', 'heldSecurityDeposit'] as const;
const OVERRIDE_TEXT_FIELDS = ['renewalDate', 'joinDate', 'details'] as const;

export function computePayroll(base: PayrollBase, overrides: Record<string, any>, securityDeposit: number, otherDeductions: number) {
  const o = overrides ?? {};
  const pick = (key: string, fallback: number) => {
    const v = o[key];
    if (v === undefined || v === null || v === '') return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const grossSalary = pick('grossSalary', base.grossSalary);
  const lateMarks = pick('lateMarks', base.lateMarks);
  const paidLeaveAllowance = pick('paidLeaveAllowance', base.paidLeaveAllowance);
  const doubleDeductionLeave = pick('doubleDeductionLeave', base.doubleDeductionLeave);
  const threshold = base.lateMarkThreshold > 0 ? base.lateMarkThreshold : 3;
  const lateLeaveDeduction = Math.floor(lateMarks / threshold) * (base.leavePerThreshold || 1);
  const beyondAllowance = money(Math.max(0, base.leaveUsed + lateLeaveDeduction - paidLeaveAllowance));
  // V1.9: days before joining / after exit are deducted like DDL (outside the paid-leave allowance)
  const deductionLeave = pick('deductionLeave', money(beyondAllowance + doubleDeductionLeave + (base.notEmployedDays ?? 0)));
  const excessLeaveDeduction = money(Math.max(0, beyondAllowance - lateLeaveDeduction));
  const dailySalary = pick('dailySalary', grossSalary / Math.max(1, base.calendarDays));
  const leaveDeductionAmount = pick('leaveDeductionAmount', money(dailySalary * deductionLeave));
  const penalty = pick('penalty', base.penalty);
  const ptax = pick('ptax', base.ptax);
  const payableAmount = pick(
    'payableAmount',
    money(Math.max(0, grossSalary - leaveDeductionAmount - penalty - ptax - securityDeposit - otherDeductions)),
  );
  return {
    grossSalary, lateMarks, paidLeaveAllowance, doubleDeductionLeave, lateLeaveDeduction,
    excessLeaveDeduction, deductionLeave, dailySalary, leaveDeductionAmount, penalty, ptax, payableAmount,
  };
}

function traceOf(v: ReturnType<typeof computePayroll>, base: PayrollBase, securityDeposit: number, otherDeductions: number) {
  return {
    grossSalary: v.grossSalary,
    dailySalary: money(v.dailySalary),
    leaveUsed: base.leaveUsed,
    paidLeaveAllowance: v.paidLeaveAllowance,
    excessLeaveDeduction: v.excessLeaveDeduction,
    lateMarks: v.lateMarks,
    lateLeaveDeduction: v.lateLeaveDeduction,
    doubleDeductionLeave: v.doubleDeductionLeave,
    notEmployedDays: base.notEmployedDays ?? 0,
    totalDeductionLeave: v.deductionLeave,
    attendanceDeduction: v.leaveDeductionAmount,
    penalty: v.penalty,
    ptax: v.ptax,
    securityDeposit,
    otherDeductions,
    payable: v.payableAmount,
  };
}

// Rebuilds the calculated (pre-edit) inputs of a saved PayrollResult from its
// calculation trace, falling back to the columns for results saved before V1.7.
function baseFromResult(r: any): PayrollBase {
  const snap: any = r.ruleSnapshot && typeof r.ruleSnapshot === 'object' ? r.ruleSnapshot : {};
  const t: any = snap.calculationTrace ?? {};
  const num = (v: any, fallback: any) => (v === undefined || v === null || !Number.isFinite(Number(v)) ? Number(fallback ?? 0) : Number(v));
  return {
    grossSalary: num(t.grossSalary, r.grossSalary),
    calendarDays: Number(r.calendarDays) || 30,
    leaveUsed: num(t.leaveUsed, r.stwiLeaveDays),
    lateMarks: num(t.lateMarks, r.lateMarks),
    paidLeaveAllowance: num(t.paidLeaveAllowance, r.paidLeaveAllowance),
    doubleDeductionLeave: num(t.doubleDeductionLeave, r.doubleDeductionLeave),
    penalty: num(t.penalty, r.penalty),
    ptax: num(t.ptax, r.ptax),
    lateMarkThreshold: num(snap.late_mark_threshold, 3),
    leavePerThreshold: num(snap.leave_per_threshold, 1),
    notEmployedDays: num(t.notEmployedDays, 0),
  };
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

      // V1.7: an unreadable workbook is recorded as ERROR for this file only,
      // instead of throwing and aborting the remaining files of a ZIP batch.
      let parsed: ReturnType<RunsService['parseAttendanceWorkbook']>;
      try {
        parsed = this.parseAttendanceWorkbook(file.buffer);
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        await this.prisma.attendanceFile.create({
          data: { payrollRunId: runId, originalName: file.originalname, employeeCode: parseFilename(file.originalname), fileHash: hash, status: 'ERROR', errorMessage: error },
        });
        out.push({ file: file.originalname, status: 'ERROR', error });
        continue;
      }
      const filenameEmployeeCode = parseFilename(file.originalname);
      const employeeCode = parsed.employeeCode || filenameEmployeeCode;
      let employee = employeeCode ? await this.prisma.employee.findUnique({ where: { employeeCode } }) : null;
      if (!employee && employeeCode) {
        // e.g. file "Attendance_entries_2026-SEP-06_..." for Employee ID 2026/sep/06
        const all = await this.prisma.employee.findMany({ where: { deletedAt: null } });
        employee = all.find((e) => codeKey(e.employeeCode) === codeKey(employeeCode)) ?? null;
      }

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
      if (filenameEmployeeCode && parsed.employeeCode && codeKey(filenameEmployeeCode) !== codeKey(parsed.employeeCode)) {
        // V1.7: mark the file itself as MISMATCH so Process does not later
        // flag it PROCESSED although no rows were imported from it.
        await this.prisma.attendanceFile.update({ where: { id: attendanceFile.id }, data: { status: 'MISMATCH', errorMessage: `Filename suggests ${filenameEmployeeCode}, worksheet contains ${parsed.employeeCode}.` } });
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

      // A fresh upload for the same employee/month replaces the previously
      // IMPORTED attendance for that employee (handover §8). V1.7 preserves:
      //   * manual-entry attendance rows (added by HR in the app),
      //   * RESOLVED / REJECTED Manual Reviews (penalties, double-deduction
      //     ticks and per-day leave decisions stay on record),
      //   * the PayrollResult row (manual Payroll Review edits and the chosen
      //     security-deposit method); it is refreshed on the next Calculate.
      // Only OPEN reviews are cleared; they are rebuilt from the new file.
      await this.prisma.manualReview.deleteMany({
        where: { payrollRunId: runId, employeeId: employee.id, status: 'OPEN' },
      });

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

      // Rows created by Process Attendance for missing days (no source file and
      // no source status) are rebuilt on the next Process, so they are removed.
      // Manual-entry rows (sourceStatus set, no file) are kept.
      const fillerRows = await this.prisma.attendanceRecord.findMany({
        where: { payrollRunId: runId, employeeId: employee.id, attendanceFileId: null, sourceStatus: null },
        select: { id: true },
      });
      if (fillerRows.length) {
        await this.prisma.leaveEvent.deleteMany({ where: { attendanceRecordId: { in: fillerRows.map((r) => r.id) } } });
        await this.prisma.attendanceRecord.deleteMany({ where: { id: { in: fillerRows.map((r) => r.id) } } });
      }
      const manualRows = await this.prisma.attendanceRecord.findMany({
        where: { payrollRunId: runId, employeeId: employee.id, attendanceFileId: null, sourceStatus: { not: null } },
        select: { workDate: true },
      });
      const manualDates = new Set(manualRows.map((r) => dateKey(r.workDate)));

      try {
        const minHalf = await this.ruleNumber('half_day_min_hours', 4);
        const maxHalf = await this.ruleNumber('half_day_max_hours', 5.5);
        const fullDayHours = await this.ruleNumber('full_day_min_hours', 8);
        let imported = 0;
        let skippedManual = 0;
        for (const row of monthRows) {
          const workDate = row.date;
          if (!workDate) continue;
          if (workDate.getUTCFullYear() !== run.year || workDate.getUTCMonth() + 1 !== run.month) continue;
          if (manualDates.has(dateKey(workDate))) { skippedManual++; continue; }

          const decision = classifyAttendanceRow(row, workDate, { minHalf, maxHalf, fullDayHours });
          let { status, leaveFraction, late, lateMinutes, reviewType, reviewReason } = decision;
          const reviewDescription = reviewType
            ? `${reviewReason} on ${dateKey(workDate)} (Zoho: "${row.status}", hours ${formatHours(row.totalHours)}).`
            : null;

          // If HR already decided this exact case (same employee, date, status and
          // hours - e.g. the same file uploaded again) and
          // the review is closed, re-apply that decision instead of reopening.
          if (reviewDescription) {
            const closed = await this.prisma.manualReview.findFirst({
              where: { payrollRunId: runId, employeeId: employee.id, description: reviewDescription, status: { not: 'OPEN' } },
            });
            const decided = parseLeaveDecision(closed?.resolution);
            if (closed && decided !== null) {
              leaveFraction = decided;
              status = statusForLeave(decided);
            }
          }

          const data = {
            attendanceFileId: attendanceFile.id,
            firstCheckIn: row.firstCheckIn,
            lastCheckOut: row.lastCheckOut,
            workedHours: row.totalHours,
            sourceStatus: row.status,
            status,
            isLate: late,
            lateMinutes,
            leaveFraction: leaveFraction || null,
            isHoliday: decision.holiday,
            isWeekOff: decision.weekend,
          };
          const record = await this.prisma.attendanceRecord.upsert({
            where: { payrollRunId_employeeId_workDate: { payrollRunId: runId, employeeId: employee.id, workDate } },
            update: data,
            create: { payrollRunId: runId, employeeId: employee.id, workDate, ...data },
          });

          if (leaveFraction > 0) {
            await this.prisma.leaveEvent.upsert({
              where: { attendanceRecordId: record.id },
              update: { leaveFraction, leaveType: decision.leaveType },
              create: { payrollRunId: runId, employeeId: employee.id, attendanceRecordId: record.id, leaveFraction, leaveType: decision.leaveType },
            });
          } else {
            await this.prisma.leaveEvent.deleteMany({ where: { attendanceRecordId: record.id } });
          }

          if (reviewType && reviewDescription) await this.ensureReview(runId, employee.id, reviewType, reviewDescription);
          imported++;
        }
        if (!imported) {
          await this.prisma.attendanceFile.update({ where: { id: attendanceFile.id }, data: { status: 'ERROR', errorMessage: 'No attendance rows for this payroll month were found in the file.' } });
          out.push({ file: file.originalname, status: 'ERROR', employeeCode, error: 'No attendance rows for this payroll month were found in the file.' });
        } else {
          out.push({ file: file.originalname, status: 'READY', employeeCode, imported, ...(skippedManual ? { keptManualRows: skippedManual } : {}) });
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
      // V1.7: a manual entry is owned by HR (no source file), so a later
      // re-upload of the employee's Zoho file keeps it instead of replacing it.
      update: { attendanceFileId: null, firstCheckIn: p.firstCheckIn, lastCheckOut: p.lastCheckOut, workedHours: p.hours, sourceStatus: body.sourceStatus ?? 'MANUAL ENTRY', status: p.status, isLate: p.isLate, lateMinutes: p.lateMinutes, leaveFraction: p.leaveFraction || null, isHoliday: Boolean(body.isHoliday), isWeekOff: Boolean(body.isWeekOff), manualNotes: body.manualNotes ?? null },
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
    // V1.7: fields that are not sent keep their current value. Previously an
    // Edit that did not send check-in/check-out/hours wiped them to null/0.
    const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
    const updated = await this.prisma.attendanceRecord.update({ where: { id: attendanceId }, data: { workDate: p.d, firstCheckIn: has('firstCheckIn') ? p.firstCheckIn : existing.firstCheckIn, lastCheckOut: has('lastCheckOut') ? p.lastCheckOut : existing.lastCheckOut, workedHours: has('workedHours') ? p.hours : existing.workedHours, sourceStatus: body.sourceStatus ?? existing.sourceStatus ?? 'MANUAL ENTRY', status: p.status, isLate: p.isLate, lateMinutes: p.lateMinutes, leaveFraction: p.leaveFraction || null, isHoliday: Boolean(body.isHoliday), isWeekOff: Boolean(body.isWeekOff), manualNotes: body.manualNotes ?? existing.manualNotes }, include: { employee: true } });
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
      // V1.9: an employee who left during/after this month is still paid for it
      where: { id: { in: sourceEmployeeIds }, deletedAt: null, OR: [{ status: 'ACTIVE' }, { dateOfExit: { gte: new Date(Date.UTC(run.year, run.month - 1, 1)) } }] },
      include: {
        salaryHistory: {
          where: { effectiveFrom: { lte: monthEnd(run.year, run.month) } },
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

    // V1.7: Process only manages the reviews it creates itself ("No attendance
    // record was found for <date>."). Reviews raised by the import (missing
    // check-in/check-out, short hours, ambiguous leave) are left untouched, so
    // they can no longer silently disappear when Process is clicked.
    const missingDayPrefix = 'No attendance record was found for';
    for (const emp of employees) {
      if (!emp.salaryHistory[0]) continue;

      for (let day = 1; day <= totalDays; day++) {
        const d = new Date(Date.UTC(run.year, run.month - 1, day));
        const missingDayDescription = `${missingDayPrefix} ${dateKey(d)}.`;
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
          // A real row (imported or manual entry) now exists for this date, so
          // an older OPEN "no record" review for the date is stale.
          if (existing.attendanceFileId || existing.sourceStatus) {
            await this.prisma.manualReview.deleteMany({
              where: { payrollRunId: runId, employeeId: emp.id, type: 'MISSING_CHECKIN', status: 'OPEN', description: missingDayDescription },
            });
          }
          continue;
        }

        const holiday = holidaySet.has(dateKey(d));
        const weekend = isWeekendDay(d);
        let status: any = holiday ? 'HOLIDAY' : weekend ? 'WEEK_OFF' : 'MANUAL_REVIEW';
        let leaveFraction = 0;

        // Re-apply a decision HR already took for this missing day.
        if (!holiday && !weekend) {
          const closed = await this.prisma.manualReview.findFirst({
            where: { payrollRunId: runId, employeeId: emp.id, description: missingDayDescription, status: { not: 'OPEN' } },
          });
          const decided = parseLeaveDecision(closed?.resolution);
          if (closed && decided !== null) {
            leaveFraction = decided;
            status = statusForLeave(decided);
          }
        }

        const record = await this.prisma.attendanceRecord.create({
          data: {
            payrollRunId: runId,
            employeeId: emp.id,
            workDate: d,
            status,
            leaveFraction: leaveFraction || null,
            isHoliday: holiday,
            isWeekOff: weekend,
          },
        });
        if (leaveFraction > 0) {
          await this.prisma.leaveEvent.create({ data: { payrollRunId: runId, employeeId: emp.id, attendanceRecordId: record.id, leaveFraction, leaveType: 'REVIEW_DECISION', approved: true } });
        }

        if (!holiday && !weekend) {
          await this.ensureReview(runId, emp.id, 'MISSING_CHECKIN', missingDayDescription);
        }
      }
    }

    await this.prisma.attendanceFile.updateMany({
      where: { payrollRunId: runId, status: 'READY' },
      data: { status: 'PROCESSED' },
    });

    await this.flagLeavers(run);
    const openReviews = await this.prisma.manualReview.count({ where: { payrollRunId: runId, status: 'OPEN' } });
    const status = 'REVIEW';
    const updated = await this.prisma.payrollRun.update({ where: { id: runId }, data: { status, processedAt: new Date() } });
    await this.audit.log({ userId, action: 'PROCESS_ATTENDANCE', entityType: 'PayrollRun', entityId: runId, afterJson: { importedCount, openReviews } });
    return { run: updated, importedCount, openReviews };
  }

  /**
   * V1.9: an employee whose Date of Exit falls in this month gets a Manual Review:
   * the last month is settled by hand (Payroll Review edits), as STWI decided.
   */
  private async flagLeavers(run: { id: string; year: number; month: number }) {
    const start = new Date(Date.UTC(run.year, run.month - 1, 1));
    const end = new Date(Date.UTC(run.year, run.month, 0, 23, 59, 59));
    const withAttendance = await this.prisma.attendanceRecord.findMany({ where: { payrollRunId: run.id }, select: { employeeId: true }, distinct: ['employeeId'] });
    const leavers = await this.prisma.employee.findMany({ where: { id: { in: withAttendance.map((a) => a.employeeId) }, deletedAt: null, dateOfExit: { gte: start, lte: end } } });
    for (const e of leavers) {
      const exit = e.dateOfExit!.toISOString().slice(0, 10).split('-').reverse().join('-');
      await this.ensureReview(run.id, e.id, 'OTHER', `Last month: ${e.name} left on ${exit} (Date of Exit). Check this month's pay by hand in Payroll Review (days after the exit, security deposit, final settlement), then resolve this review.`);
    }
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

  async resolveReview(userId: string, reviewId: string, body: { resolution?: string; penaltyAmount?: number; doubleDeductionLeave?: boolean; status?: 'RESOLVED' | 'REJECTED'; leaveFraction?: number | string | null }) {
    const review = await this.prisma.manualReview.findUnique({ where: { id: reviewId } });
    if (!review) throw new NotFoundException('Review not found');
    const run = await this.prisma.payrollRun.findUnique({ where: { id: review.payrollRunId } });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (run.status === 'FINALIZED') throw new BadRequestException('Finalized run is locked');
    if (review.status !== 'OPEN') throw new BadRequestException('Review is already closed');
    const status = body.status === 'REJECTED' ? 'REJECTED' : 'RESOLVED';

    // V1.7: HR decides the leave for the day under review (0 = present,
    // 0.5 = half day, 1 = full day). The decision is written to that day's
    // attendance row and kept in the resolution text as "[leave=x]" so it is
    // re-applied if the same file is uploaded again.
    let resolution = body.resolution ?? null;
    const hasLeaveDecision = body.leaveFraction !== undefined && body.leaveFraction !== null && body.leaveFraction !== '';
    if (hasLeaveDecision) {
      const leave = Number(body.leaveFraction);
      if (!Number.isFinite(leave) || leave < 0 || leave > 1) throw new BadRequestException('Leave for the day must be between 0 and 1 (e.g. 0, 0.5 or 1).');
      const date = review.description.match(/(\d{4}-\d{2}-\d{2})/)?.[1];
      if (!review.employeeId || !date) throw new BadRequestException('This review is not linked to a single attendance day, so a leave decision cannot be applied.');
      const record = await this.prisma.attendanceRecord.findUnique({
        where: { payrollRunId_employeeId_workDate: { payrollRunId: review.payrollRunId, employeeId: review.employeeId, workDate: new Date(`${date}T00:00:00.000Z`) } },
      });
      if (!record) throw new NotFoundException(`No attendance row found for ${date}. Process Attendance first.`);
      const before = { ...record };
      await this.prisma.attendanceRecord.update({ where: { id: record.id }, data: { leaveFraction: leave || null, status: statusForLeave(leave) } });
      await this.prisma.leaveEvent.deleteMany({ where: { attendanceRecordId: record.id } });
      if (leave > 0) await this.prisma.leaveEvent.create({ data: { payrollRunId: review.payrollRunId, employeeId: review.employeeId, attendanceRecordId: record.id, leaveFraction: leave, leaveType: 'REVIEW_DECISION', approved: true } });
      await this.audit.log({ userId, employeeId: review.employeeId, action: 'REVIEW_LEAVE_DECISION', entityType: 'AttendanceRecord', entityId: record.id, beforeJson: before, afterJson: { leaveFraction: leave, reviewId } });
      resolution = `${resolution ? resolution + ' ' : ''}[leave=${leave}]`;
    }

    const updated = await this.prisma.manualReview.update({ where: { id: reviewId }, data: { status, resolution, penaltyAmount: body.penaltyAmount, doubleDeductionLeave: body.doubleDeductionLeave ?? review.doubleDeductionLeave, assignedToId: userId, resolvedAt: new Date() } });
    await this.audit.log({ userId, employeeId: review.employeeId ?? undefined, action: 'RESOLVE', entityType: 'ManualReview', entityId: reviewId, beforeJson: review, afterJson: updated });
    return updated;
  }

  async calculatePayroll(runId: string, userId: string) {
    const run = await this.prisma.payrollRun.findUnique({ where: { id: runId } });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (run.status === 'FINALIZED') throw new BadRequestException('Finalized run is locked');
    const sourceCount = await this.prisma.attendanceFile.count({ where: { payrollRunId: runId, status: 'PROCESSED' } });
    if (!sourceCount) throw new BadRequestException('Process at least one uploaded attendance file before calculating payroll.');
    await this.flagLeavers(run);
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
      // V1.9: an employee who left during/after this month is still paid for it
      where: { id: { in: sourceEmployeeIds }, deletedAt: null, OR: [{ status: 'ACTIVE' }, { dateOfExit: { gte: new Date(Date.UTC(run.year, run.month - 1, 1)) } }] },
      include: {
        salaryHistory: {
          where: { effectiveFrom: { lte: monthEnd(run.year, run.month) } },
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
      // V1.9: days before the joining date are not paid (deducted like DDL) and
      // attendance on those days is ignored. Leavers: see lastPaid below.
      const DAY = 86400000;
      const utcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
      const monthStart = Date.UTC(run.year, run.month - 1, 1);
      const monthLast = Date.UTC(run.year, run.month - 1, calendarDays);
      const firstPaid = emp.joiningDate ? Math.max(monthStart, utcDay(emp.joiningDate)) : monthStart;
      // STWI (28 Sep): the last month of someone who leaves is checked by hand
      // (a Manual Review is raised), so the exit date does not cut the pay here.
      const lastPaid = monthLast;
      if (lastPaid < firstPaid) continue; // joined after this month
      const notEmployedDays = calendarDays - (Math.round((lastPaid - firstPaid) / DAY) + 1);
      const employed = records.filter(r => { const t = utcDay(r.workDate); return t >= firstPaid && t <= lastPaid; });
      const weekOffDays = employed.filter(r => r.isWeekOff && !r.isHoliday).length;
      const holidayDays = employed.filter(r => r.isHoliday && !r.isWeekOff).length;
      const leaveUsed = money(employed.reduce((s, r) => s + Number(r.leaveFraction ?? 0), 0));
      const lateMarks = employed.filter(r => r.isLate).length;
      const doubleDeductionLeave = reviews.reduce((s, r) => s + (r.doubleDeductionLeave ? rules.double_deduction_leave_days : 0), 0);
      const penalty = money(reviews.reduce((s, r) => s + Number(r.penaltyAmount ?? 0), 0));
      // Confirmed STWI rule: gross salary strictly greater than ₹12,000 attracts ₹200 P.Tax.
      // V1.9: P.Tax can be switched off per employee (Employee > Payroll details)
      const ptax = emp.professionalTaxApplicable && gross > rules.ptax_threshold ? rules.ptax_amount : 0;

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

      const existingSnapshot: any = existingResult?.ruleSnapshot && typeof existingResult.ruleSnapshot === 'object'
        ? existingResult.ruleSnapshot
        : {};

      // Security deposit is 0 until HR/CEO chooses FULL or EMI; a choice made in
      // this run is preserved across recalculations.
      let securityDeposit = existingResult ? Number(existingResult.securityDeposit) : 0;
      if (existingResult && deposit && securityDeposit > 0 && Number(deposit.additionalRequired) <= 0) {
        securityDeposit = 0;
      }
      // V1.7: an EMI started in an earlier month continues automatically with
      // the same installment amount (handover rule 21), unless HR used Undo
      // for this run.
      if (
        securityDeposit <= 0 &&
        !existingSnapshot.depositSkipped &&
        deposit &&
        deposit.method === 'EMI_3_MONTHS' &&
        Number(deposit.additionalRequired) > 0 &&
        Number(deposit.installmentAmount) > 0 &&
        deposit.transactions.some((t) => t.payrollRunId !== runId)
      ) {
        securityDeposit = money(Math.min(Number(deposit.installmentAmount), Number(deposit.additionalRequired)));
      }
      const otherDeductions = existingResult ? Number(existingResult.otherDeductions) : 0;

      const base: PayrollBase = {
        grossSalary: gross,
        calendarDays,
        leaveUsed,
        lateMarks,
        paidLeaveAllowance: rules.paid_leave_allowance,
        doubleDeductionLeave,
        penalty,
        ptax,
        lateMarkThreshold: rules.late_mark_threshold,
        leavePerThreshold: rules.leave_per_threshold,
        notEmployedDays,
      };
      const calculated = computePayroll(base, {}, securityDeposit, otherDeductions);
      // V1.7: manual Payroll Review edits are re-applied on every recalculation
      // (including the recalculation done by Finalize), so they are not lost.
      const manualOverrides = existingSnapshot.manualOverrides ?? {};
      const eff = computePayroll(base, manualOverrides, securityDeposit, otherDeductions);

      const snapshot = {
        ...rules,
        calculationTrace: traceOf(calculated, base, securityDeposit, otherDeductions),
        effective: traceOf(eff, base, securityDeposit, otherDeductions),
        manualOverrides,
        ...(existingSnapshot.depositSkipped ? { depositSkipped: true } : {}),
      };
      const columns = {
        grossSalary: eff.grossSalary, calendarDays, weekOffDays, holidayDays,
        paidLeaveAllowance: eff.paidLeaveAllowance, stwiLeaveDays: leaveUsed, lateMarks: eff.lateMarks,
        lateLeaveDeduction: eff.lateLeaveDeduction, excessLeaveDeduction: eff.excessLeaveDeduction,
        doubleDeductionLeave: eff.doubleDeductionLeave, penalty: eff.penalty, securityDeposit, ptax: eff.ptax,
        otherDeductions, payableAmount: eff.payableAmount, ruleSnapshot: snapshot,
      };
      await this.prisma.payrollResult.upsert({
        where: { payrollRunId_employeeId: { payrollRunId: runId, employeeId: emp.id } },
        update: columns,
        create: { payrollRunId: runId, employeeId: emp.id, ...columns },
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
      const overrides: any = snapshot.manualOverrides ?? {};
      const eff = computePayroll(baseFromResult(r), overrides, Number(r.securityDeposit), Number(r.otherDeductions));
      return {
        ...r,
        workingDays: Number(overrides.workingDays ?? (Number(r.calendarDays) - Number(r.weekOffDays) - Number(r.holidayDays))),
        dailySalary: eff.dailySalary,
        deductionLeave: eff.deductionLeave,
        leaveDeductionAmount: eff.leaveDeductionAmount,
        halfDayCount: Number(overrides.halfDayCount ?? (byEmployee.get(r.employeeId)?.halfDayCount ?? 0)),
        totalLeave: Number(overrides.totalLeave ?? (Number(r.stwiLeaveDays) + Number(r.lateLeaveDeduction))),
        heldSecurityDeposit: Number(overrides.heldSecurityDeposit ?? Number(r.securityDeposit)),
        renewalDate: overrides.renewalDate ?? null,
        joiningDate: overrides.joinDate ?? r.employee.joiningDate,
        manuallyEdited: Object.keys(overrides).length > 0,
      };
    });
    return paged(enriched, total, page, pageSize);
  }

  // Re-computes and saves a result after an edit (Payroll Review edit, other
  // deduction, deposit method, undo). Every path uses computePayroll, so the
  // payable always matches the calculation shown on screen and in Excel.
  private async saveResult(result: any, changes: { manualOverrides?: any; securityDeposit?: number; otherDeductions?: number; snapshotFlags?: Record<string, any> }) {
    const snapshot: any = result.ruleSnapshot && typeof result.ruleSnapshot === 'object' ? result.ruleSnapshot : {};
    const manualOverrides = changes.manualOverrides ?? snapshot.manualOverrides ?? {};
    const securityDeposit = changes.securityDeposit ?? Number(result.securityDeposit);
    const otherDeductions = changes.otherDeductions ?? Number(result.otherDeductions);
    const base = baseFromResult(result);
    const eff = computePayroll(base, manualOverrides, securityDeposit, otherDeductions);
    const nextSnapshot = { ...snapshot, ...(changes.snapshotFlags ?? {}), manualOverrides, effective: traceOf(eff, base, securityDeposit, otherDeductions) };
    for (const [k, v] of Object.entries(changes.snapshotFlags ?? {})) if (v === undefined) delete nextSnapshot[k];
    return this.prisma.payrollResult.update({
      where: { id: result.id },
      data: {
        grossSalary: eff.grossSalary,
        paidLeaveAllowance: eff.paidLeaveAllowance,
        lateMarks: eff.lateMarks,
        lateLeaveDeduction: eff.lateLeaveDeduction,
        excessLeaveDeduction: eff.excessLeaveDeduction,
        doubleDeductionLeave: eff.doubleDeductionLeave,
        penalty: eff.penalty,
        ptax: eff.ptax,
        securityDeposit,
        otherDeductions,
        payableAmount: eff.payableAmount,
        ruleSnapshot: nextSnapshot,
      },
    });
  }

  async updatePayrollResult(userId: string, runId: string, employeeId: string, body: any) {
    const run = await this.prisma.payrollRun.findUnique({ where: { id: runId } });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (run.status === 'FINALIZED') throw new BadRequestException('Finalized run is locked');

    const result = await this.prisma.payrollResult.findUnique({
      where: { payrollRunId_employeeId: { payrollRunId: runId, employeeId } },
    });
    if (!result) throw new NotFoundException('Payroll result not found');

    const snapshot: any = result.ruleSnapshot && typeof result.ruleSnapshot === 'object' ? result.ruleSnapshot : {};
    // V1.7 (Q8 = fully editable): only the fields the user actually changed are
    // sent. They are stored as overrides, survive Calculate/Finalize, and the
    // payable is recalculated from them unless the payable itself was edited.
    // "resetOverrides: true" removes all manual edits for this employee.
    const manualOverrides: any = body.resetOverrides ? {} : { ...(snapshot.manualOverrides ?? {}) };
    for (const field of [...OVERRIDE_NUMERIC_FIELDS, ...OVERRIDE_DISPLAY_NUMERIC_FIELDS]) {
      if (!(field in body)) continue;
      const v = body[field];
      if (v === null || v === '') { delete manualOverrides[field]; continue; }
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) throw new BadRequestException(`Invalid value for ${field}`);
      manualOverrides[field] = field === 'lateMarks' ? Math.round(n) : money(n);
    }
    for (const field of OVERRIDE_TEXT_FIELDS) {
      if (!(field in body)) continue;
      const v = body[field];
      if (v === null || v === '') delete manualOverrides[field];
      else manualOverrides[field] = String(v);
    }

    const amount = (field: string) => {
      if (!(field in body) || body[field] === null || body[field] === '') return undefined;
      const n = Number(body[field]);
      if (!Number.isFinite(n) || n < 0) throw new BadRequestException(`Invalid value for ${field}`);
      return money(n);
    };
    const updated = await this.saveResult(result, {
      manualOverrides,
      securityDeposit: amount('securityDeposit'),
      otherDeductions: amount('otherDeductions'),
    });
    await this.audit.log({
      userId, employeeId, action: body.resetOverrides ? 'RESET_PAYROLL_EDITS' : 'EDIT_PAYROLL_RESULT', entityType: 'PayrollResult', entityId: result.id,
      beforeJson: result, afterJson: updated,
    });
    return updated;
  }

  async setOtherDeduction(userId: string, runId: string, employeeId: string, amount: number) {
    const run = await this.prisma.payrollRun.findUnique({ where: { id: runId } });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (run.status === 'FINALIZED') throw new BadRequestException('Finalized run is locked');
    const result = await this.prisma.payrollResult.findUnique({ where: { payrollRunId_employeeId: { payrollRunId: runId, employeeId } } });
    if (!result) throw new NotFoundException('Payroll result not found');
    const normalized = money(Math.max(0, Number(amount) || 0));
    const updated = await this.saveResult(result, { otherDeductions: normalized });
    await this.audit.log({ userId, employeeId, action: 'SET_OTHER_DEDUCTION', entityType: 'PayrollResult', entityId: result.id, afterJson: { amount: normalized } });
    return updated;
  }

  async setDepositMethod(
    userId: string,
    runId: string,
    employeeId: string,
    method: 'FULL' | 'EMI_3_MONTHS',
  ): Promise<any> {
    const run = await this.prisma.payrollRun.findUnique({ where: { id: runId } });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (run.status === 'FINALIZED') throw new BadRequestException('Finalized run is locked');
    if (method !== 'FULL' && method !== 'EMI_3_MONTHS') throw new BadRequestException('Method must be FULL or EMI_3_MONTHS');

    let result = await this.prisma.payrollResult.findUnique({ where: { payrollRunId_employeeId: { payrollRunId: runId, employeeId } } });
    if (!result) {
      await this.calculatePayroll(runId, userId);
      result = await this.prisma.payrollResult.findUnique({ where: { payrollRunId_employeeId: { payrollRunId: runId, employeeId } } });
    }
    if (!result) throw new NotFoundException('Payroll result not found');

    const deposit = await this.prisma.securityDeposit.findFirst({ where: { employeeId, status: 'ACTIVE' }, orderBy: { createdAt: 'desc' }, include: { transactions: true } });
    if (!deposit) return result;

    const remaining = Math.max(0, Number(deposit.additionalRequired));
    if (remaining <= 0) {
      return this.saveResult(result, { securityDeposit: 0 });
    }

    // V1.7: once an EMI has started (installments taken in earlier runs), the
    // installment amount stays the same when EMI is selected again.
    const emiInProgress = deposit.method === 'EMI_3_MONTHS' && Number(deposit.installmentAmount) > 0 && deposit.transactions.some((t) => t.payrollRunId !== runId);
    const installmentCount = method === 'FULL' ? 1 : 3;
    const installmentAmount = method === 'FULL'
      ? remaining
      : emiInProgress ? money(Math.min(Number(deposit.installmentAmount), remaining)) : money(remaining / installmentCount);
    await this.prisma.securityDeposit.update({
      where: { id: deposit.id },
      data: { method, installmentCount, ...(method === 'EMI_3_MONTHS' && emiInProgress ? {} : { installmentAmount }) },
    });

    const updated = await this.saveResult(result, { securityDeposit: installmentAmount, snapshotFlags: { depositSkipped: undefined } });
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
      const amount = money(Math.min(Number(result.securityDeposit), Number(deposit.additionalRequired)));
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
      const workingDays = r.calendarDays - Number(r.weekOffDays) - Number(r.holidayDays);
      const snap = (r.ruleSnapshot as any) || {};
      const trace = snap.calculationTrace;
      const overrides = snap.manualOverrides || {};
      // V1.7: same arithmetic as the app (computePayroll), including edits.
      const eff = computePayroll(baseFromResult(r), overrides, Number(r.securityDeposit), Number(r.otherDeductions));
      paySheet.addRow([
        index + 1,
        r.employee.name,
        Number(overrides.workingDays ?? workingDays),
        eff.grossSalary,
        Number(r.securityDeposit),
        Number(r.securityDeposit),
        eff.leaveDeductionAmount,
        eff.penalty,
        eff.ptax,
        eff.payableAmount,
        eff.deductionLeave,
        Number(overrides.halfDayCount ?? halfDays),
        eff.lateMarks,
        eff.paidLeaveAllowance,
        eff.doubleDeductionLeave,
        Number(overrides.totalLeave ?? money(leaveUsed + eff.lateLeaveDeduction)),
        overrides.joinDate ? new Date(overrides.joinDate) : (r.employee.joiningDate ?? ''),
        overrides.renewalDate ?? '',
        Number(overrides.heldSecurityDeposit ?? (heldByEmployee.get(r.employeeId) || 0)),
        overrides.details || (trace ? JSON.stringify(trace) : ''),
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
    const run = await this.prisma.payrollRun.findUnique({ where: { id: runId } });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (run.status === 'FINALIZED') throw new BadRequestException('Finalized run cannot be changed.');

    const result = await this.prisma.payrollResult.findUnique({
      where: { payrollRunId_employeeId: { payrollRunId: runId, employeeId } },
    });
    if (!result) throw new NotFoundException('Payroll result not found');

    const deposit = await this.prisma.securityDeposit.findFirst({
      where: { employeeId, status: 'ACTIVE' },
      include: { transactions: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!deposit) return result;

    if (deposit.transactions.some((t) => t.payrollRunId === runId)) {
      throw new BadRequestException('This deposit has already been finalized for the run and cannot be undone.');
    }

    // Clears only this run's deduction; the held balance is untouched. The
    // depositSkipped flag stops an in-progress EMI from being re-applied
    // automatically on the next Calculate for this run.
    const updated = await this.saveResult(result, { securityDeposit: 0, snapshotFlags: { depositSkipped: true } });

    await this.audit.log({
      userId,
      employeeId,
      action: 'RESET_SECURITY_DEPOSIT_METHOD',
      entityType: 'PayrollResult',
      entityId: result.id,
      afterJson: { securityDeposit: 0 },
    });

    return updated;
  }

}
