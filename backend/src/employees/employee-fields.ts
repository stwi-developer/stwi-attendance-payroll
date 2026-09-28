// V1.9: one definition of the employee fields, shared by manual entry, the
// Zoho "Employee View" import and editing. Change a rule here and it applies
// everywhere.

export type FieldSource = 'zoho' | 'manual';
export type FieldKind = 'code' | 'text' | 'email' | 'date' | 'phone' | 'aadhaar' | 'pan' | 'ifsc' | 'account' | 'money' | 'bool' | 'longtext' | 'choice';

export type EmployeeFieldDef = {
  key: string;
  label: string;
  source: FieldSource;
  kind: FieldKind;
  required: boolean;
  /** column header in the Zoho Employee View export */
  zohoHeader?: string;
  /** where to fix a missing value in Zoho People */
  zohoHint?: string;
  choices?: string[];
};

// Yellow columns (taken from the Zoho export) ------------------------------
export const ZOHO_FIELDS: EmployeeFieldDef[] = [
  { key: 'employeeCode', label: 'Employee ID', source: 'zoho', kind: 'code', required: true, zohoHeader: 'Employee ID', zohoHint: 'Employee profile > Employee ID' },
  { key: 'firstName', label: 'First Name', source: 'zoho', kind: 'text', required: true, zohoHeader: 'First Name', zohoHint: 'Employee profile > First Name' },
  { key: 'lastName', label: 'Last Name', source: 'zoho', kind: 'text', required: true, zohoHeader: 'Last Name', zohoHint: 'Employee profile > Last Name' },
  { key: 'email', label: 'Email address', source: 'zoho', kind: 'email', required: true, zohoHeader: 'Email address', zohoHint: 'Employee profile > Email address' },
  { key: 'department', label: 'Department', source: 'zoho', kind: 'text', required: true, zohoHeader: 'Department', zohoHint: 'Employee profile > Work information > Department' },
  { key: 'designation', label: 'Designation', source: 'zoho', kind: 'text', required: true, zohoHeader: 'Designation', zohoHint: 'Employee profile > Work information > Designation' },
  { key: 'employmentType', label: 'Employment Type', source: 'zoho', kind: 'text', required: true, zohoHeader: 'Employment Type', zohoHint: 'Employee profile > Work information > Employment Type' },
  { key: 'joiningDate', label: 'Date of Joining', source: 'zoho', kind: 'date', required: true, zohoHeader: 'Date of Joining', zohoHint: 'Employee profile > Work information > Date of Joining' },
  // Zoho calculates Total Experience itself; it is empty for someone who joined this month.
  { key: 'totalExperience', label: 'Total Experience', source: 'zoho', kind: 'text', required: false, zohoHeader: 'Total Experience', zohoHint: 'Employee profile > Work experience' },
  { key: 'dateOfBirth', label: 'Date of Birth', source: 'zoho', kind: 'date', required: true, zohoHeader: 'Date of Birth', zohoHint: 'Employee profile > Personal details > Date of Birth' },
  { key: 'gender', label: 'Gender', source: 'zoho', kind: 'choice', required: true, choices: ['Male', 'Female'], zohoHeader: 'Gender', zohoHint: 'Employee profile > Personal details > Gender' },
  { key: 'maritalStatus', label: 'Marital Status', source: 'zoho', kind: 'choice', required: true, choices: ['Single', 'Married'], zohoHeader: 'Marital Status', zohoHint: 'Employee profile > Personal details > Marital Status' },
];

// Green columns (filled in the app; pre-filled from Zoho when the export has them).
// Date of Exit is also green; it is set with the Deactivate button, not in these forms.
export const MANUAL_FIELDS: EmployeeFieldDef[] = [
  { key: 'personalMobile', label: 'Personal Mobile Number', source: 'manual', kind: 'phone', required: true, zohoHeader: 'Personal Mobile Number' },
  { key: 'personalEmail', label: 'Personal Email Address', source: 'manual', kind: 'email', required: true, zohoHeader: 'Personal Email Address' },
  { key: 'permanentAddress', label: 'Permanent Address', source: 'manual', kind: 'longtext', required: true, zohoHeader: 'Permanent Address' },
  { key: 'aadhaar', label: 'Aadhaar', source: 'manual', kind: 'aadhaar', required: true, zohoHeader: 'Aadhaar' },
  { key: 'pan', label: 'PAN', source: 'manual', kind: 'pan', required: true, zohoHeader: 'PAN' },
];

// Payroll details (always typed in the app, never from Excel).
// V1.9: bank details removed from the employee (STWI, 28 Sep); the old DB columns stay unused.
export const PAYROLL_FIELDS: EmployeeFieldDef[] = [
  { key: 'grossSalary', label: 'Gross Salary (₹ per month)', source: 'manual', kind: 'money', required: true },
  { key: 'salaryEffectiveFrom', label: 'Salary Effective From', source: 'manual', kind: 'date', required: true },
  { key: 'securityDepositAlreadyTaken', label: 'Security Deposit Already Taken (₹)', source: 'manual', kind: 'money', required: true },
  { key: 'professionalTaxApplicable', label: 'Professional Tax applicable', source: 'manual', kind: 'bool', required: true },
  { key: 'notes', label: 'Notes', source: 'manual', kind: 'longtext', required: false },
];

export const ALL_FIELDS = [...ZOHO_FIELDS, ...MANUAL_FIELDS, ...PAYROLL_FIELDS];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** STWI Employee ID: yyyy/mmm/code (month in any case, e.g. 2026/sep/06 or 2026/SEP/06). Older IDs without "/" (01, 12, 81) stay valid. */
const EMPLOYEE_CODE = /^\d{4}\/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\/[a-z0-9-]+$/i;
export function checkEmployeeCode(v: string): string | null {
  if (/\s/.test(v)) return 'Employee ID cannot contain spaces.';
  if (!v.includes('/')) return /^[A-Za-z0-9-]+$/.test(v) ? null : 'Employee ID can only contain letters, digits, "-" and "/".';
  return EMPLOYEE_CODE.test(v) ? null : 'Employee ID must look like yyyy/mmm/code, e.g. 2026/sep/06 (month in upper or lower case).';
}
const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export function isBlank(v: unknown) {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

/** Clean a value into the form it is stored in (trimmed text, upper-case PAN, digits-only Aadhaar, ISO date). */
export function normalizeValue(def: EmployeeFieldDef, v: unknown): any {
  if (isBlank(v)) return def.kind === 'bool' ? undefined : null;
  switch (def.kind) {
    case 'bool': return v === true || v === 'true' || v === 1 || v === '1' || v === 'Yes';
    case 'money': return Number(v);
    case 'date': return toIsoDate(v);
    case 'email': return String(v).trim().toLowerCase();
    case 'pan': case 'ifsc': return String(v).replace(/\s+/g, '').toUpperCase();
    case 'aadhaar': case 'account': return String(v).replace(/[\s-]+/g, '');
    case 'phone': return String(v).trim().replace(/\s+/g, ' ');
    default: return String(v).trim();
  }
}

/** Returns an error text, or null when the (already normalized) value is valid. */
export function checkValue(def: EmployeeFieldDef, v: any): string | null {
  if (isBlank(v)) return def.required ? `${def.label} is required.` : null;
  switch (def.kind) {
    case 'code': return checkEmployeeCode(String(v));
    case 'email': return EMAIL.test(v) ? null : `${def.label} is not a valid email address.`;
    case 'date': return v ? null : `${def.label} is not a valid date.`;
    case 'phone': return String(v).replace(/\D/g, '').length >= 10 ? null : `${def.label} needs at least 10 digits (e.g. 91-9876543210).`;
    case 'aadhaar': return /^\d{12}$/.test(v) ? null : `${def.label} must be 12 digits.`;
    case 'pan': return PAN.test(v) ? null : `${def.label} must look like ABCDE1234F.`;
    case 'ifsc': return IFSC.test(v) ? null : `${def.label} must look like SBIN0001234 (11 characters).`;
    case 'account': return /^\d{6,20}$/.test(v) ? null : `${def.label} must be 6 to 20 digits.`;
    case 'money': return Number.isFinite(v) && v >= 0 ? null : `${def.label} must be a valid amount (0 or more).`;
    default: return null;
  }
}

/** Accepts a Date, an Excel serial number, "2026-09-21", "21-09-2026" or "21-Sep-2026". Returns YYYY-MM-DD or null. */
export function toIsoDate(v: unknown): string | null {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    // SheetJS gives local-midnight dates; round to the nearest day to avoid time-zone drift
    const d = new Date(v.getTime() + 12 * 3600 * 1000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    const ms = Math.round((v - 25569) * 86400 * 1000);
    return new Date(ms).toISOString().slice(0, 10);
  }
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/ ](\d{1,2})[-/ ](\d{4})$/);
  if (m) return valid(+m[3], +m[2], +m[1]);
  m = s.match(/^(\d{1,2})[-/ ]([A-Za-z]{3,})[-/ ,]*(\d{4})$/);
  if (m) {
    const month = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
    if (month) return valid(+m[3], month, +m[1]);
  }
  return null;
}

function valid(y: number, mo: number, d: number) {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** Excel column letter for a 0-based index (0 -> A, 27 -> AB). */
export function columnLetter(i: number) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
