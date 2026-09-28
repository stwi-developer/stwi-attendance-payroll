// V1.9: employee fields, same keys and rules as backend/src/employees/employee-fields.ts.
// If a field becomes required/optional, change it in BOTH files.

export type Kind = 'code' | 'text' | 'email' | 'date' | 'phone' | 'aadhaar' | 'pan' | 'ifsc' | 'account' | 'money' | 'bool' | 'longtext' | 'choice' | 'department' | 'designation' | 'employmentType';
export type FieldDef = { key: string; label: string; kind: Kind; required: boolean; choices?: string[]; placeholder?: string; help?: string };

/** Yellow columns: come from the Zoho Employee View export. */
export const ZOHO_FIELDS: FieldDef[] = [
  { key: 'employeeCode', label: 'Employee ID', kind: 'code', required: true, placeholder: 'e.g. 2026/sep/06', help: 'Format yyyy/mmm/code (month upper or lower case), exactly as in Zoho. Attendance files are matched by it.' },
  { key: 'firstName', label: 'First Name', kind: 'text', required: true },
  { key: 'lastName', label: 'Last Name', kind: 'text', required: true },
  { key: 'email', label: 'Email address', kind: 'email', required: true, placeholder: 'office email' },
  { key: 'department', label: 'Department', kind: 'department', required: true },
  { key: 'designation', label: 'Designation', kind: 'designation', required: true },
  { key: 'employmentType', label: 'Employment Type', kind: 'employmentType', required: true },
  { key: 'joiningDate', label: 'Date of Joining', kind: 'date', required: true },
  { key: 'totalExperience', label: 'Total Experience', kind: 'text', required: false, placeholder: 'e.g. 1 year(s) 7 month(s)' },
  { key: 'dateOfBirth', label: 'Date of Birth', kind: 'date', required: true },
  { key: 'gender', label: 'Gender', kind: 'choice', required: true, choices: ['Male', 'Female'] },
  { key: 'maritalStatus', label: 'Marital Status', kind: 'choice', required: true, choices: ['Single', 'Married'] },
];

/** Green columns: typed in the app (pre-filled when Zoho already has them). */
export const PERSONAL_FIELDS: FieldDef[] = [
  { key: 'personalMobile', label: 'Personal Mobile Number', kind: 'phone', required: true, placeholder: '91-9876543210' },
  { key: 'personalEmail', label: 'Personal Email Address', kind: 'email', required: true },
  { key: 'aadhaar', label: 'Aadhaar', kind: 'aadhaar', required: true, placeholder: '12 digits' },
  { key: 'pan', label: 'PAN', kind: 'pan', required: true, placeholder: 'ABCDE1234F' },
  { key: 'permanentAddress', label: 'Permanent Address', kind: 'longtext', required: true },
];

export const SALARY_FIELDS: FieldDef[] = [
  { key: 'grossSalary', label: 'Gross Salary (₹ per month)', kind: 'money', required: true },
  { key: 'salaryEffectiveFrom', label: 'Salary Effective From', kind: 'date', required: true, help: 'Usually the joining date.' },
  { key: 'securityDepositAlreadyTaken', label: 'Security Deposit Already Taken (₹)', kind: 'money', required: true, help: '0 if nothing was taken yet.' },
  { key: 'professionalTaxApplicable', label: 'Professional Tax applicable', kind: 'bool', required: true, help: '₹200 when gross salary is above ₹12,000.' },
];

export const BANK_FIELDS: FieldDef[] = [
  { key: 'bankAccountName', label: 'Account Holder Name', kind: 'text', required: true },
  { key: 'bankName', label: 'Bank Name', kind: 'text', required: true },
  { key: 'bankAccountNumber', label: 'Account Number', kind: 'account', required: true },
  { key: 'bankIfsc', label: 'IFSC', kind: 'ifsc', required: true, placeholder: 'SBIN0001234' },
];

export const NOTES_FIELD: FieldDef = { key: 'notes', label: 'Notes', kind: 'longtext', required: false };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Same checks as the backend, so mistakes show before saving. */
export function checkField(f: FieldDef, raw: any): string | null {
  const blank = raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '');
  if (f.kind === 'bool') return null;
  if (blank) return f.required ? `${f.label} is required.` : null;
  const v = String(raw).trim();
  switch (f.kind) {
    case 'code':
      if (/\s/.test(v)) return 'Cannot contain spaces.';
      if (!v.includes('/')) return /^[A-Za-z0-9-]+$/.test(v) ? null : 'Only letters, digits, "-" and "/".';
      return /^\d{4}\/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\/[a-z0-9-]+$/i.test(v) ? null : 'Must look like yyyy/mmm/code, e.g. 2026/sep/06.';
    case 'email': return EMAIL.test(v) ? null : 'Not a valid email address.';
    case 'phone': return v.replace(/\D/g, '').length >= 10 ? null : 'Needs at least 10 digits (e.g. 91-9876543210).';
    case 'aadhaar': return /^\d{12}$/.test(v.replace(/[\s-]/g, '')) ? null : 'Must be 12 digits.';
    case 'pan': return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v.replace(/\s/g, '').toUpperCase()) ? null : 'Must look like ABCDE1234F.';
    case 'ifsc': return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v.replace(/\s/g, '').toUpperCase()) ? null : 'Must look like SBIN0001234.';
    case 'account': return /^\d{6,20}$/.test(v.replace(/[\s-]/g, '')) ? null : 'Must be 6 to 20 digits.';
    case 'money': return Number.isFinite(Number(v)) && Number(v) >= 0 ? null : 'Must be an amount (0 or more).';
    default: return null;
  }
}

export function checkAll(fields: FieldDef[], values: Record<string, any>) {
  const errors: Record<string, string> = {};
  for (const f of fields) { const e = checkField(f, values[f.key]); if (e) errors[f.key] = e; }
  return errors;
}

export const isoDay = (v?: string | null) => (v ? String(v).slice(0, 10) : '');
export const showDate = (v?: string | null) => (v ? new Date(`${isoDay(v)}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
/** Today's date on this computer (India time), as YYYY-MM-DD. */
export const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
/** 1st of next month, the usual date for a salary change. */
export const firstOfNextMonth = () => { const d = new Date(); const n = new Date(d.getFullYear(), d.getMonth() + 1, 1); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-01`; };
