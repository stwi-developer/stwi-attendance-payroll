import { PrismaService } from './prisma.service';

/**
 * V1.9 (STWI 21 Oct, KP-12): rules are dated by month. A rule version applies
 * from the 1st of the month HR picked ("effectiveFrom") until a newer version
 * starts. The value used for a payroll month is the newest version that starts
 * on or before the last day of that month (if none, the oldest version).
 */
export const RULE_KEYS: Record<string, { label: string; kind: 'number' | 'time' }> = {
  paid_leave_allowance: { label: 'Paid leave per month (days)', kind: 'number' },
  late_mark_threshold: { label: 'Late marks that make 1 leave', kind: 'number' },
  leave_per_threshold: { label: 'Leave days per late-mark group', kind: 'number' },
  normal_login: { label: 'Late after (normal day)', kind: 'time' },
  first_half_login: { label: 'Late after (first-half leave day)', kind: 'time' },
  ptax_threshold: { label: 'P.Tax when gross is above (₹)', kind: 'number' },
  ptax_amount: { label: 'P.Tax amount (₹)', kind: 'number' },
  full_day_min_hours: { label: 'Full day needs (hours)', kind: 'number' },
  half_day_min_hours: { label: 'Half day needs (hours)', kind: 'number' },
  half_day_max_hours: { label: 'Half day maximum (hours, unnamed STWI leave)', kind: 'number' },
};

export function monthStartUTC(year: number, month: number) { return new Date(Date.UTC(year, month - 1, 1)); }
export function monthEndUTC(year: number, month: number) { return new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)); }

export async function ruleVersionFor(prisma: PrismaService, key: string, year: number, month: number) {
  const r = await prisma.ruleDefinition.findFirst({ where: { key, effectiveFrom: { lte: monthEndUTC(year, month) } }, orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }] });
  return r ?? prisma.ruleDefinition.findFirst({ where: { key }, orderBy: [{ effectiveFrom: 'asc' }, { createdAt: 'desc' }] });
}
