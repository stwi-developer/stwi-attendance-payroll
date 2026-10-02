const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

// V1.9: count running requests so the app can show a loading bar (ui/loading.tsx)
let inflight = 0;
const loadingListeners = new Set<(n: number) => void>();
export function onLoadingChange(fn: (n: number) => void) { loadingListeners.add(fn); return () => { loadingListeners.delete(fn); }; }
function track(delta: number) { inflight = Math.max(0, inflight + delta); loadingListeners.forEach((f) => f(inflight)); }
async function tracked<T>(work: () => Promise<T>): Promise<T> { track(1); try { return await work(); } finally { track(-1); } }

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  return tracked(() => requestRaw<T>(path, options));
}

async function requestRaw<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('accessToken');
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const message = typeof data === 'string' ? data : data?.message || 'Request failed';
    throw new ApiError(Array.isArray(message) ? message.join(', ') : String(message), typeof data === 'object' ? data?.fieldErrors : undefined);
  }
  return data as T;
}

/** V1.9: errors carry per-field messages (e.g. { pan: 'PAN must look like ABCDE1234F.' }) */
export class ApiError extends Error {
  constructor(message: string, public fieldErrors?: Record<string, string>) { super(message); }
}

async function download(path: string, fallbackName: string) { return tracked(() => downloadRaw(path, fallbackName)); }
async function downloadRaw(path: string, fallbackName: string) {
  const token = localStorage.getItem('accessToken');
  const res = await fetch(`${API_URL}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const type = res.headers.get('content-type') || '';
    const data = type.includes('application/json') ? await res.json() : await res.text();
    throw new Error(typeof data === 'string' ? data : data?.message || 'Download failed');
  }
  const cd = res.headers.get('content-disposition') || '';
  const name = /filename="?([^"]+)"?/.exec(cd)?.[1] || fallbackName;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  return name;
}

const query = (params: Record<string, unknown>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
};

export type User = { id: string; email: string; name: string; role: string; status?: string };
export type Pagination = { page: number; pageSize: number; total: number; totalPages: number };
export type Page<T> = { data: T[]; pagination: Pagination; /** V1.9 reviews list: items that block Calculate */ blocking?: number };
export type SalaryHistory = { id: string; effectiveFrom: string; grossSalary: string|number; notes?: string|null };
export type DepositTransaction = { id: string; installmentNumber: number; amount: string|number; transactionDate: string; note?: string|null };
export type SecurityDeposit = { id: string; triggerReason: string; previousSalary: string|number; currentSalary: string|number; requiredDeposit: string|number; alreadyHeld: string|number; additionalRequired: string|number; method: string; installmentCount: number; installmentAmount: string|number; status: string; transactions?: DepositTransaction[] };
export type Employee = { id: string; employeeCode: string; name: string; email?: string|null; joiningDate?: string|null; status: string; department?: {id:string;name:string;parent?:{id:string;name:string}|null}|null; designation?: {id:string;name:string}|null; salaryHistory: SalaryHistory[]; deposits: SecurityDeposit[];
  // V1.9
  firstName?: string|null; lastName?: string|null; employmentType?: string|null; totalExperience?: string|null; dateOfBirth?: string|null; gender?: string|null; maritalStatus?: string|null;
  personalMobile?: string|null; personalEmail?: string|null; dateOfExit?: string|null; permanentAddress?: string|null; aadhaar?: string|null; pan?: string|null;
  professionalTaxApplicable?: boolean; bankAccountName?: string|null; bankName?: string|null; bankAccountNumber?: string|null; bankIfsc?: string|null; notes?: string|null;
  depositHeld?: number; updatedAt?: string };
export type ImportRow = { id:string; rowNumber:number; employeeCode:string; action:'NEW'|'EXISTING'; status:string; zohoJson:{values:Record<string,any>;cells:Record<string,string>;zohoStatus?:string}; manualJson?:Record<string,any>|null; problemsJson?:{field:string;label:string;message:string;cell?:string}[]|null; diffJson?:{field:string;label:string;from:string;to:string}[]|null; employeeId?:string|null; missingCount:number };
export type ImportBatch = { id:string; fileName:string; status:string; createdAt:string; missingJson?:{id:string;employeeCode:string;name:string}[]|null; rows:ImportRow[]; summary:Record<string,number> };
export type Run = { id:string; year:number; month:number; status:string; createdAt:string; processedAt?:string|null; finalizedAt?:string|null; reopenedAt?:string|null; _count?:{files:number;attendance:number;manualReviews:number;payrollResults:number}; files?:AttendanceFile[]; manualReviews?:Review[]; payrollResults?:PayrollResult[] };
export type AttendanceFile = { id:string; originalName:string; employeeCode?:string|null; status:string; uploadedAt:string; errorMessage?:string|null };
export type PayrollResult = { id:string; employeeId:string; employee:Employee; grossSalary:string|number; calendarDays:number; weekOffDays:string|number; holidayDays:string|number; paidLeaveAllowance:string|number; stwiLeaveDays:string|number; lateMarks:number; lateLeaveDeduction:string|number; excessLeaveDeduction:string|number; doubleDeductionLeave:string|number; penalty:string|number; securityDeposit:string|number; ptax:string|number; otherDeductions:string|number; payableAmount:string|number; workingDays?:number; dailySalary?:number; leaveDeductionAmount?:number; halfDayCount?:number; totalLeave?:number; heldSecurityDeposit?:number; renewalDate?:string|null; deductionLeave?:number; manuallyEdited?:boolean; ruleSnapshot?:any };
export type Review = { id:string; employee?:Employee|null; type:string; status:string; description:string; createdAt:string; /** V1.9: what to fix in Zoho */ solution?:string; /** false = information only (leaver), does not block Calculate */ blocking?:boolean };
export type AttendanceRecord = { id:string; employee:Employee; employeeId:string; workDate:string; firstCheckIn?:string|null; lastCheckOut?:string|null; workedHours?:string|number|null; sourceStatus?:string|null; status:string; isLate:boolean; lateMinutes:number; leaveFraction?:string|number|null; isHoliday:boolean; isWeekOff:boolean; isSandwich?:boolean; sourceJson?:Record<string,any>|null; manualNotes?:string|null; checkInNotes?:string|null; checkOutNotes?:string|null; leaveEvent?:any };

export const api = {
  login:(email:string,password:string)=>request<{accessToken:string;user:User}>('/auth/login',{method:'POST',body:JSON.stringify({email,password})}),
  me:()=>request<User>('/auth/me'),
  dashboard:()=>request<any>('/dashboard/summary'),

  employees:(params:Record<string,unknown>={})=>request<Page<Employee>>(`/employees${query(params)}`),
  employee:(id:string)=>request<Employee>(`/employees/${id}`),
  createEmployee:(payload:any)=>request<Employee>('/employees',{method:'POST',body:JSON.stringify(payload)}),
  updateEmployee:(id:string,payload:any)=>request<Employee>(`/employees/${id}`,{method:'PUT',body:JSON.stringify(payload)}),
  deleteEmployee:(id:string,confirmCode:string)=>request<any>(`/employees/${id}`,{method:'DELETE',body:JSON.stringify({confirmCode})}),
  addSalary:(id:string,payload:any)=>request<Employee>(`/employees/${id}/salaries`,{method:'POST',body:JSON.stringify(payload)}),
  updateSalary:(id:string,salaryId:string,payload:any)=>request<Employee>(`/employees/${id}/salaries/${salaryId}`,{method:'PUT',body:JSON.stringify(payload)}),
  deleteSalary:(id:string,salaryId:string)=>request<Employee>(`/employees/${id}/salaries/${salaryId}`,{method:'DELETE'}),
  deactivateEmployee:(id:string,dateOfExit:string)=>request<Employee>(`/employees/${id}/deactivate`,{method:'POST',body:JSON.stringify({dateOfExit})}),
  reactivateEmployee:(id:string)=>request<Employee>(`/employees/${id}/reactivate`,{method:'POST'}),
  exportEmployee:(id:string)=>download(`/employees/${id}/export`,'Employee.xlsx'),

  currentImport:()=>request<ImportBatch|null>('/employee-imports/current'),
  uploadImport:(file:File)=>{const fd=new FormData();fd.append('file',file);return request<ImportBatch>('/employee-imports',{method:'POST',body:fd});},
  saveImportRow:(batchId:string,rowId:string,payload:any)=>request<{batch:ImportBatch;fieldErrors:Record<string,string>}>(`/employee-imports/${batchId}/rows/${rowId}`,{method:'PUT',body:JSON.stringify(payload)}),
  createFromImport:(batchId:string,rowIds?:string[])=>request<{created:string[];failed:{employeeCode:string;message:string}[];batch:ImportBatch}>(`/employee-imports/${batchId}/create`,{method:'POST',body:JSON.stringify({rowIds})}),
  applyImportRow:(batchId:string,rowId:string)=>request<ImportBatch>(`/employee-imports/${batchId}/rows/${rowId}/apply`,{method:'POST'}),
  skipImportRow:(batchId:string,rowId:string)=>request<ImportBatch>(`/employee-imports/${batchId}/rows/${rowId}/skip`,{method:'POST'}),
  cancelImport:(batchId:string)=>request<any>(`/employee-imports/${batchId}`,{method:'DELETE'}),

  labels:()=>request<Record<string,string>>('/labels'),
  setLabel:(key:string,value:string)=>request<any>(`/labels/${encodeURIComponent(key)}`,{method:'PUT',body:JSON.stringify({value})}),
  resetLabel:(key:string)=>request<any>(`/labels/${encodeURIComponent(key)}`,{method:'DELETE'}),
  employmentTypes:()=>request<any[]>('/reference/employment-types'),
  addDesignation:(name:string)=>request<any>('/reference/designations',{method:'POST',body:JSON.stringify({name})}),
  addEmploymentType:(name:string)=>request<any>('/reference/employment-types',{method:'POST',body:JSON.stringify({name})}),

  departments:()=>request<any[]>('/reference/departments'),
  designations:()=>request<any[]>('/reference/designations'),
  rules:()=>request<any[]>('/reference/rules'),
  updateRule:(key:string,value:string)=>request<any>(`/reference/rules/${encodeURIComponent(key)}`,{method:'PATCH',body:JSON.stringify({value})}),

  runs:(params:Record<string,unknown>={})=>request<Page<Run>>(`/runs${query(params)}`),
  createRun:(year:number,month:number)=>request<Run>('/runs',{method:'POST',body:JSON.stringify({year,month})}),
  run:(id:string)=>request<Run>(`/runs/${id}`),
  deleteRun:(id:string)=>request<any>(`/runs/${id}`,{method:'DELETE'}),
  uploadRun:(id:string,files:File[])=>{const fd=new FormData();for(const f of files)fd.append('files',f);return request<any[]>(`/runs/${id}/upload`,{method:'POST',body:fd});},
  deleteRunFile:(runId:string,fileId:string)=>request<any>(`/runs/${runId}/files/${fileId}`,{method:'DELETE'}),
  processRun:(id:string)=>request<any>(`/runs/${id}/process`,{method:'POST'}),
  calculateRun:(id:string)=>request<any>(`/runs/${id}/calculate`,{method:'POST'}),
  attendance:(id:string,params:Record<string,unknown>={})=>request<Page<AttendanceRecord>>(`/runs/${id}/attendance${query(params)}`),
  attendanceSummary:(id:string)=>request<any>(`/runs/${id}/attendance-summary`),
  addManualAttendance:(id:string,payload:any)=>request<AttendanceRecord>(`/runs/${id}/attendance/manual`,{method:'POST',body:JSON.stringify(payload)}),
  updateAttendance:(runId:string,attendanceId:string,payload:any)=>request<AttendanceRecord>(`/runs/${runId}/attendance/${attendanceId}`,{method:'PATCH',body:JSON.stringify(payload)}),
  deleteAttendance:(runId:string,attendanceId:string)=>request<any>(`/runs/${runId}/attendance/${attendanceId}`,{method:'DELETE'}),
  reviews:(id:string,params:Record<string,unknown>={})=>request<Page<Review>>(`/runs/${id}/reviews${query(params)}`),
  payroll:(id:string,params:Record<string,unknown>={})=>request<Page<PayrollResult>>(`/runs/${id}/payroll${query(params)}`),
  setDepositMethod:(runId:string,employeeId:string,method:string)=>request<any>(`/runs/${runId}/payroll/${employeeId}/security-deposit`,{method:'PATCH',body:JSON.stringify({method})}),
  updatePayrollResult:(runId:string,employeeId:string,payload:any)=>request<any>(`/runs/${runId}/payroll/${employeeId}`,{method:'PATCH',body:JSON.stringify(payload)}),
  setOtherDeduction:(runId:string,employeeId:string,amount:number)=>request<any>(`/runs/${runId}/payroll/${employeeId}/other-deduction`,{method:'PATCH',body:JSON.stringify({amount})}),
  finalizeRun:(id:string)=>request<Run>(`/runs/${id}/finalize`,{method:'POST'}),
  reopenRun:(id:string)=>request<Run>(`/runs/${id}/reopen`,{method:'POST'}),
  exportRun: (id:string)=>download(`/runs/${id}/export`,`STWI_Attendance_Payroll_${id}.xlsx`),
  resetDepositMethod: (
  runId: string,
  employeeId: string,
) =>
  request<any>(
    `/runs/${runId}/payroll/${employeeId}/security-deposit/reset`,
    {
      method: 'PATCH',
    },
  ),
};
