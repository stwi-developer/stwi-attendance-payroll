const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('accessToken');
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const message = typeof data === 'string' ? data : data?.message || 'Request failed';
    throw new Error(Array.isArray(message) ? message.join(', ') : String(message));
  }
  return data as T;
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
export type Page<T> = { data: T[]; pagination: Pagination };
export type SalaryHistory = { id: string; effectiveFrom: string; grossSalary: string|number; notes?: string|null };
export type DepositTransaction = { id: string; installmentNumber: number; amount: string|number; transactionDate: string; note?: string|null };
export type SecurityDeposit = { id: string; triggerReason: string; previousSalary: string|number; currentSalary: string|number; requiredDeposit: string|number; alreadyHeld: string|number; additionalRequired: string|number; method: string; installmentCount: number; installmentAmount: string|number; status: string; transactions?: DepositTransaction[] };
export type Employee = { id: string; employeeCode: string; name: string; email?: string|null; joiningDate?: string|null; status: string; department?: {id:string;name:string}|null; designation?: {id:string;name:string}|null; salaryHistory: SalaryHistory[]; deposits: SecurityDeposit[] };
export type Run = { id:string; year:number; month:number; status:string; createdAt:string; processedAt?:string|null; finalizedAt?:string|null; reopenedAt?:string|null; _count?:{files:number;attendance:number;manualReviews:number;payrollResults:number}; files?:AttendanceFile[]; manualReviews?:Review[]; payrollResults?:PayrollResult[] };
export type AttendanceFile = { id:string; originalName:string; employeeCode?:string|null; status:string; uploadedAt:string; errorMessage?:string|null };
export type PayrollResult = { id:string; employeeId:string; employee:Employee; grossSalary:string|number; calendarDays:number; weekOffDays:string|number; holidayDays:string|number; paidLeaveAllowance:string|number; stwiLeaveDays:string|number; lateMarks:number; lateLeaveDeduction:string|number; excessLeaveDeduction:string|number; doubleDeductionLeave:string|number; penalty:string|number; securityDeposit:string|number; ptax:string|number; otherDeductions:string|number; payableAmount:string|number; ruleSnapshot?:any };
export type Review = { id:string; employee?:Employee|null; type:string; status:string; description:string; resolution?:string|null; penaltyAmount?:string|number|null; doubleDeductionLeave:boolean; createdAt:string; resolvedAt?:string|null };
export type AttendanceRecord = { id:string; employee:Employee; employeeId:string; workDate:string; firstCheckIn?:string|null; lastCheckOut?:string|null; workedHours?:string|number|null; sourceStatus?:string|null; status:string; isLate:boolean; lateMinutes:number; leaveFraction?:string|number|null; isHoliday:boolean; isWeekOff:boolean; manualNotes?:string|null; leaveEvent?:any };

export const api = {
  login:(email:string,password:string)=>request<{accessToken:string;user:User}>('/auth/login',{method:'POST',body:JSON.stringify({email,password})}),
  me:()=>request<User>('/auth/me'),
  dashboard:()=>request<any>('/dashboard/summary'),

  employees:(params:Record<string,unknown>={})=>request<Page<Employee>>(`/employees${query(params)}`),
  employee:(id:string)=>request<Employee>(`/employees/${id}`),
  createEmployee:(payload:any)=>request<Employee>('/employees',{method:'POST',body:JSON.stringify(payload)}),
  updateEmployee:(id:string,payload:any)=>request<Employee>(`/employees/${id}`,{method:'PUT',body:JSON.stringify(payload)}),
  deleteEmployee:(id:string)=>request<any>(`/employees/${id}`,{method:'DELETE'}),

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
  resolveReview:(reviewId:string,payload:any)=>request<Review>(`/runs/reviews/${reviewId}`,{method:'PATCH',body:JSON.stringify(payload)}),
  deleteReview:(reviewId:string)=>request<any>(`/runs/reviews/${reviewId}`,{method:'DELETE'}),
  payroll:(id:string,params:Record<string,unknown>={})=>request<Page<PayrollResult>>(`/runs/${id}/payroll${query(params)}`),
  setDepositMethod:(runId:string,employeeId:string,method:string)=>request<any>(`/runs/${runId}/payroll/${employeeId}/security-deposit`,{method:'PATCH',body:JSON.stringify({method})}),
  setOtherDeduction:(runId:string,employeeId:string,amount:number)=>request<any>(`/runs/${runId}/payroll/${employeeId}/other-deduction`,{method:'PATCH',body:JSON.stringify({amount})}),
  finalizeRun:(id:string)=>request<Run>(`/runs/${id}/finalize`,{method:'POST'}),
  reopenRun:(id:string)=>request<Run>(`/runs/${id}/reopen`,{method:'POST'}),
  exportRun: async (id:string)=>{
    const token=localStorage.getItem('accessToken');
    const res=await fetch(`${API_URL}/runs/${id}/export`,{headers:{Authorization:`Bearer ${token}`}});
    if(!res.ok){const type=res.headers.get('content-type')||'';const data=type.includes('application/json')?await res.json():await res.text();throw new Error(typeof data==='string'?data:data?.message||'Export failed');}
    const blob=await res.blob();const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`STWI_Attendance_Payroll_${id}.xlsx`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
  },
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
