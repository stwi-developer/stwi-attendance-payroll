import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { api, AttendanceFile, AttendanceRecord, Employee, Page, Pagination, PayrollResult, Review, Run, User } from './api';

const currency=(v:any)=>`₹${Number(v||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const monthName=(m:number)=>m?new Date(2000,m-1,1).toLocaleString('en-IN',{month:'long'}):'—';
const errMessage=(e:unknown)=>e instanceof Error?e.message:'Something went wrong';

function ErrorBox({message}:{message:string}){return message?<div className="error">{message}</div>:null}
function PaginationControls({pagination,onChange}:{pagination?:Pagination;onChange:(page:number)=>void}){if(!pagination||pagination.total===0)return null;return <div className="pagination"><span>Showing {Math.min((pagination.page-1)*pagination.pageSize+1,pagination.total)}–{Math.min(pagination.page*pagination.pageSize,pagination.total)} of {pagination.total}</span><div className="actions"><button disabled={pagination.page<=1} onClick={()=>onChange(pagination.page-1)}>Previous</button><span>Page {pagination.page}/{Math.max(1,pagination.totalPages)}</span><button disabled={pagination.page>=pagination.totalPages} onClick={()=>onChange(pagination.page+1)}>Next</button></div></div>}
function PageSize({value,onChange}:{value:number;onChange:(v:number)=>void}){return <select className="page-size" value={value} onChange={e=>onChange(Number(e.target.value))}><option>10</option><option>25</option><option>50</option><option>100</option></select>}
function ConfirmButton({children,onConfirm,disabled=false}:{children:any;onConfirm:()=>void;disabled?:boolean}){return <button disabled={disabled} onClick={()=>{if(window.confirm('Are you sure?'))onConfirm()}}>{children}</button>}

function Login({onLogin}:{onLogin:(u:User)=>void}){const nav=useNavigate();const[email,setEmail]=useState('ceo@company.local');const[password,setPassword]=useState('ChangeMe123!');const[error,setError]=useState('');return <div className="login-wrap"><form className="login-card" onSubmit={async e=>{e.preventDefault();try{const r=await api.login(email,password);localStorage.setItem('accessToken',r.accessToken);onLogin(r.user);nav('/')}catch(err){setError(errMessage(err))}}}><h1>STWI Attendance &amp; Payroll</h1><p>Internal HR &amp; Payroll</p><label>Email<input value={email} onChange={e=>setEmail(e.target.value)}/></label><label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)}/></label><ErrorBox message={error}/><button>Sign in</button></form></div>}
function Dashboard({user}:{user:User}){const[data,setData]=useState<any>();const[error,setError]=useState('');useEffect(()=>{api.dashboard().then(setData).catch(e=>setError(errMessage(e)))},[]);return <div><div className="page-head"><div><h1>Dashboard</h1><p>Welcome, {user.name} · {user.role}</p></div></div><ErrorBox message={error}/><div className="stats-grid"><div className="metric"><span>Active Employees</span><strong>{data?.employees??'—'}</strong></div><div className="metric"><span>Latest Run</span><strong>{data?.latestRun?`${monthName(data.latestRun.month)} ${data.latestRun.year}`:'—'}</strong><small>{data?.latestRun?.status||'No run yet'}</small></div><div className="metric"><span>Open Reviews</span><strong>{data?.latestRun?.reviewsOpen??0}</strong></div><div className="metric"><span>Payroll Results</span><strong>{data?.latestRun?.payrollResults??0}</strong></div></div><div className="grid"><Link className="card" to="/employees"><strong>Employees</strong><span>Master data, salary and deposit.</span></Link><Link className="card" to="/runs"><strong>Monthly Run</strong><span>Upload, process, review and calculate.</span></Link><Link className="card" to="/reviews"><strong>Manual Review</strong><span>Resolve attendance exceptions.</span></Link><Link className="card" to="/payroll"><strong>Payroll</strong><span>Review, export and finalize.</span></Link></div></div>}

function Employees(){const nav=useNavigate();const[result,setResult]=useState<Page<Employee>|null>();const[page,setPage]=useState(1);const[pageSize,setPageSize]=useState(25);const[error,setError]=useState('');const[departments,setDepartments]=useState<any[]>([]);const[designations,setDesignations]=useState<any[]>([]);const[filters,setFilters]=useState({search:'',status:'',departmentId:'',designationId:'',minSalary:'',maxSalary:''});const[f,setF]=useState({employeeCode:'',name:'',email:'',grossSalary:'',securityDepositAlreadyTaken:'',joiningDate:'',departmentId:'',designationId:''});
  const load=()=>api.employees({...filters,page,pageSize}).then(setResult).catch(e=>setError(errMessage(e)));
  useEffect(()=>{Promise.all([api.departments().then(setDepartments),api.designations().then(setDesignations)]).catch(()=>{});},[]);useEffect(()=>{void load()},[page,pageSize,JSON.stringify(filters)]);
  const sf=(k:string,v:string)=>{setPage(1);setFilters({...filters,[k]:v})};
  return <div><div className="page-head"><div><h1>Employees</h1><p>Create, update, deactivate and safely delete master data.</p></div></div><ErrorBox message={error}/><div className="split"><form className="panel" onSubmit={async e=>{e.preventDefault();try{const emp=await api.createEmployee({...f,grossSalary:Number(f.grossSalary),securityDepositAlreadyTaken: Number(f.securityDepositAlreadyTaken || 0),email:f.email||undefined,joiningDate:f.joiningDate||undefined,departmentId:f.departmentId||undefined,designationId:f.designationId||undefined});nav(`/employees/${emp.id}`)}catch(err){setError(errMessage(err))}}}><h3>Add Employee</h3><label>Employee ID<input required value={f.employeeCode} onChange={e=>setF({...f,employeeCode:e.target.value})}/></label><label>Name<input required value={f.name} onChange={e=>setF({...f,name:e.target.value})}/></label><label>Email<input type="email" value={f.email} onChange={e=>setF({...f,email:e.target.value})}/></label><label>Joining Date<input type="date" value={f.joiningDate} onChange={e=>setF({...f,joiningDate:e.target.value})}/></label><label>Department<select value={f.departmentId} onChange={e=>setF({...f,departmentId:e.target.value})}><option value="">Select</option>{departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label><label>Designation<select value={f.designationId} onChange={e=>setF({...f,designationId:e.target.value})}><option value="">Select</option>{designations.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
  <label>Gross Salary<input required type="number" min="0" value={f.grossSalary} onChange={e=>setF({...f,grossSalary:e.target.value})}/></label>
  <label>
  Security Deposit Already Taken
  <input
    type="number"
    min="0"
    step="0.01"
    value={f.securityDepositAlreadyTaken}
    onChange={e =>
      setF({
        ...f,
        securityDepositAlreadyTaken: e.target.value
      })
    }
  />
</label>
  <button>Create Employee</button></form><div className="panel"><div className="panel-head"><h3>Employee List</h3><PageSize value={pageSize} onChange={v=>{setPageSize(v);setPage(1)}}/></div><div className="filters"><input placeholder="Search ID / name / email" value={filters.search} onChange={e=>sf('search',e.target.value)}/><select value={filters.status} onChange={e=>sf('status',e.target.value)}><option value="">All Statuses</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select><select value={filters.departmentId} onChange={e=>sf('departmentId',e.target.value)}><option value="">All Departments</option>{departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select><select value={filters.designationId} onChange={e=>sf('designationId',e.target.value)}><option value="">All Designations</option>{designations.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select><input placeholder="Min salary" type="number" value={filters.minSalary} onChange={e=>sf('minSalary',e.target.value)}/><input placeholder="Max salary" type="number" value={filters.maxSalary} onChange={e=>sf('maxSalary',e.target.value)}/><button onClick={()=>{setFilters({search:'',status:'',departmentId:'',designationId:'',minSalary:'',maxSalary:''});setPage(1)}}>Clear</button></div>{result?.data.length?<table><thead><tr><th>ID</th><th>Name</th><th>Department</th><th>Designation</th><th>Salary</th><th>Status</th><th>Open</th></tr></thead><tbody>{result.data.map(e=><tr key={e.id}><td>{e.employeeCode}</td><td>{e.name}</td><td>{e.department?.name||'—'}</td><td>{e.designation?.name||'—'}</td><td>{currency(e.salaryHistory[0]?.grossSalary)}</td><td>{e.status}</td><td><button onClick={()=>nav(`/employees/${e.id}`)}>Open</button></td></tr>)}</tbody></table>:<div className="empty">No employees found.</div>}<PaginationControls pagination={result?.pagination} onChange={setPage}/></div></div></div>}

function EmployeeDetail(){const{id}=useParams();const nav=useNavigate();const[emp,setEmp]=useState<Employee|null>();const[error,setError]=useState('');const[edit,setEdit]=useState({name:'',email:'',joiningDate:'',departmentId:'',designationId:'',status:'ACTIVE'});const[salary,setSalary]=useState('');const[date,setDate]=useState(new Date().toISOString().slice(0,10));const[departments,setDepartments]=useState<any[]>([]);const[designations,setDesignations]=useState<any[]>([]);const load=async()=>{if(!id)return;try{const e=await api.employee(id);setEmp(e);setEdit({name:e.name,email:e.email||'',joiningDate:e.joiningDate?e.joiningDate.slice(0,10):'',departmentId:e.department?.id||'',designationId:e.designation?.id||'',status:e.status});setSalary(String(e.salaryHistory[0]?.grossSalary||''))}catch(err){setError(errMessage(err))}};useEffect(()=>{void load();Promise.all([api.departments().then(setDepartments),api.designations().then(setDesignations)]).catch(()=>{})},[id]);
const held = useMemo(() => {
  if (!emp?.deposits?.length) return 0;

  return Math.max(
    ...emp.deposits.map((d: any) => Number(d.alreadyHeld || 0))
  );
}, [emp]);
const current=Number(emp?.salaryHistory[0]?.grossSalary||0);const currentMonthDays=new Date(new Date().getFullYear(),new Date().getMonth()+1,0).getDate();const additional=Math.max(0,current-held);return <div><div className="page-head"><div><button onClick={()=>nav('/employees')}>← Back</button><h1>{emp?.name||'Employee'}</h1><p>{emp?.employeeCode||''}</p></div></div><ErrorBox message={error}/>{!emp?<div className="panel">Loading…</div>:<><div className="stats-grid"><div className="metric"><span>Current Salary</span><strong>{currency(current)}</strong></div><div className="metric"><span>Deposit Held</span><strong>{currency(held)}</strong></div><div className="metric"><span>Additional Deposit</span><strong>{currency(additional)}</strong></div><div className="metric"><span>Daily Salary</span><strong>{currency(current/currentMonthDays)}</strong></div></div><div className="detail-grid"><section className="panel"><h3>Employee Information</h3><form onSubmit={async e=>{e.preventDefault();try{await api.updateEmployee(id!,{...edit,email:edit.email||undefined,joiningDate:edit.joiningDate||undefined,departmentId:edit.departmentId||undefined,designationId:edit.designationId||undefined});await load();}catch(err){setError(errMessage(err))}}}><label>Employee ID<input value={emp.employeeCode} readOnly/></label><label>Name<input value={edit.name} onChange={e=>setEdit({...edit,name:e.target.value})}/></label><label>Email<input value={edit.email} onChange={e=>setEdit({...edit,email:e.target.value})}/></label><label>Joining Date<input type="date" value={edit.joiningDate} onChange={e=>setEdit({...edit,joiningDate:e.target.value})}/></label><label>Department<select value={edit.departmentId} onChange={e=>setEdit({...edit,departmentId:e.target.value})}><option value="">None</option>{departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label><label>Designation<select value={edit.designationId} onChange={e=>setEdit({...edit,designationId:e.target.value})}><option value="">None</option>{designations.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label><label>Status<select value={edit.status} onChange={e=>setEdit({...edit,status:e.target.value})}><option value="ACTIVE">ACTIVE</option><option value="INACTIVE">INACTIVE</option></select></label><button>Save Employee</button></form></section><section className="panel"><h3>Salary Update</h3><form onSubmit={async e=>{e.preventDefault();try{await api.updateEmployee(id!,{grossSalary:Number(salary),salaryEffectiveFrom:date});await load()}catch(err){setError(errMessage(err))}}}><label>New Gross Salary<input type="number" value={salary} onChange={e=>setSalary(e.target.value)}/></label><label>Effective From<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><button>Save Salary</button></form><h3>Security Deposit</h3><p className="muted">Target = current salary; increment collects only the shortfall.</p><div className="stats-grid"><div className="metric"><span>Required</span><strong>{currency(current)}</strong></div><div className="metric"><span>Held</span><strong>{currency(held)}</strong></div><div className="metric"><span>Additional</span><strong>{currency(additional)}</strong></div></div></section><section className="panel full-width"><h3>Salary History</h3><table><thead><tr><th>Effective</th><th>Gross</th><th>Notes</th></tr></thead><tbody>{emp.salaryHistory.map(s=><tr key={s.id}><td>{new Date(s.effectiveFrom).toLocaleDateString('en-IN')}</td><td>{currency(s.grossSalary)}</td><td>{s.notes||'—'}</td></tr>)}</tbody></table><div className="actions"><ConfirmButton onConfirm={async()=>{try{await api.deleteEmployee(id!);nav('/employees')}catch(err){setError(errMessage(err))}}}>Delete Employee</ConfirmButton></div></section></div></>}</div>}

function Runs(){const nav=useNavigate();const now=new Date();const[result,setResult]=useState<Page<Run>|null>();const[page,setPage]=useState(1);const[pageSize,setPageSize]=useState(25);const[filters,setFilters]=useState({year:'',month:'',status:'',search:''});const[year,setYear]=useState(String(now.getFullYear()));const[month,setMonth]=useState(String(now.getMonth()+1));const[error,setError]=useState('');const load=()=>api.runs({...filters,page,pageSize}).then(setResult).catch(e=>setError(errMessage(e)));useEffect(()=>{void load()},[page,pageSize,JSON.stringify(filters)]);return <div><div className="page-head"><div><h1>Monthly Runs</h1><p>Upload → Process → Manual Review → Calculate → Finalize.</p></div></div><ErrorBox message={error}/><div className="split"><form className="panel" onSubmit={async e=>{e.preventDefault();try{const r=await api.createRun(Number(year),Number(month));nav(`/runs/${r.id}`)}catch(err){setError(errMessage(err))}}}><h3>Create Monthly Run</h3><label>Year<input type="number" value={year} onChange={e=>setYear(e.target.value)}/></label><label>Month<select value={month} onChange={e=>setMonth(e.target.value)}>{Array.from({length:12},(_,i)=><option key={i+1} value={i+1}>{monthName(i+1)}</option>)}</select></label><button>Create Run</button></form><div className="panel"><div className="panel-head"><h3>Run History</h3><PageSize value={pageSize} onChange={v=>{setPageSize(v);setPage(1)}}/></div><div className="filters"><input placeholder="Search year" value={filters.search} onChange={e=>setFilters({...filters,search:e.target.value})}/><select value={filters.year} onChange={e=>setFilters({...filters,year:e.target.value})}><option value="">All Years</option>{Array.from({length:7},(_,i)=>String(now.getFullYear()-i)).map(y=><option key={y}>{y}</option>)}</select><select value={filters.month} onChange={e=>setFilters({...filters,month:e.target.value})}><option value="">All Months</option>{Array.from({length:12},(_,i)=><option key={i+1} value={i+1}>{monthName(i+1)}</option>)}</select><select value={filters.status} onChange={e=>setFilters({...filters,status:e.target.value})}><option value="">All Statuses</option>{['DRAFT','PROCESSING','REVIEW','FINALIZED','REOPENED'].map(s=><option key={s}>{s}</option>)}</select><button onClick={()=>setFilters({year:'',month:'',status:'',search:''})}>Clear</button></div>{result?.data.length?<table><thead><tr><th>Month</th><th>Status</th><th>Files</th><th>Reviews</th><th>Payroll</th><th>Action</th></tr></thead><tbody>{result.data.map(r=><tr key={r.id}><td>{monthName(r.month)} {r.year}</td><td>{r.status}</td><td>{r._count?.files??0}</td><td>{r._count?.manualReviews??0}</td><td>{r._count?.payrollResults??0}</td><td><button onClick={()=>nav(`/runs/${r.id}`)}>Open</button> <ConfirmButton onConfirm={async()=>{try{await api.deleteRun(r.id);await load()}catch(err){setError(errMessage(err))}}}>Delete</ConfirmButton></td></tr>)}</tbody></table>:<div className="empty">No runs found.</div>}<PaginationControls pagination={result?.pagination} onChange={setPage}/></div></div></div>}

function RunDetail(){
  const{id}=useParams();
  const nav=useNavigate();
  const[run,setRun]=useState<Run|null>();
  const[error,setError]=useState('');
  const[busy,setBusy]=useState('');
  const[files,setFiles]=useState<File[]>([]);
  const[attendance,setAttendance]=useState<Page<AttendanceRecord>|null>();
  const[reviews,setReviews]=useState<Page<Review>|null>();
  const[payroll,setPayroll]=useState<Page<PayrollResult>|null>();
  const[summary,setSummary]=useState<any|null>();
  const[attPage,setAttPage]=useState(1);
  const[revPage,setRevPage]=useState(1);
  const[payPage,setPayPage]=useState(1);
  const[pageSize,setPageSize]=useState(100);
  const[attFilter,setAttFilter]=useState({search:'',status:'',late:'',leave:'',holiday:'',weekOff:'',manualReview:'',dateFrom:'',dateTo:''});
  const[revFilter,setRevFilter]=useState({status:'OPEN',type:'',search:'',penaltyPresent:'',doubleDeductionLeave:''});
  const[payFilter,setPayFilter]=useState({search:'',hasLate:'',hasLeave:'',hasPenalty:'',hasPtax:'',hasSecurityDeposit:'',minGross:'',maxGross:'',minPayable:'',maxPayable:''});
  const[selectedEmployeeId,setSelectedEmployeeId]=useState('');
  const[selectedPayrollEmployees,setSelectedPayrollEmployees]=useState<string[]>([]);
  const[showSelectedPayroll,setShowSelectedPayroll]=useState(false);
  const[payrollEditId,setPayrollEditId]=useState<string|null>(null);
  const[payrollDrafts,setPayrollDrafts]=useState<Record<string,any>>({});

  const loadRun=async()=>{if(!id)return;try{setRun(await api.run(id));}catch(e){setError(errMessage(e))}};
  const loadAttendance=async()=>{if(!id)return;try{setAttendance(await api.attendance(id,{...attFilter,employeeId:selectedEmployeeId||undefined,page:attPage,pageSize}));}catch(e){setError(errMessage(e))}};
  const loadReviews=async()=>{if(!id)return;try{setReviews(await api.reviews(id,{...revFilter,employeeId:selectedEmployeeId||undefined,page:revPage,pageSize}));}catch(e){setError(errMessage(e))}};
  const loadPayroll=async()=>{if(!id)return;try{setPayroll(await api.payroll(id,{...payFilter,employeeId:selectedEmployeeId||undefined,page:payPage,pageSize}));}catch(e){setError(errMessage(e))}};
  const loadSummary=async()=>{if(!id)return;try{setSummary(await api.attendanceSummary(id));}catch(e){setError(errMessage(e))}};

  useEffect(()=>{void loadRun();void loadSummary()},[id]);
  useEffect(()=>{void loadAttendance()},[id,attPage,pageSize,JSON.stringify(attFilter),selectedEmployeeId]);
  useEffect(()=>{void loadReviews()},[id,revPage,pageSize,JSON.stringify(revFilter),selectedEmployeeId]);
  useEffect(()=>{void loadPayroll()},[id,payPage,pageSize,JSON.stringify(payFilter),selectedEmployeeId]);

  const refreshAll=async()=>{await Promise.all([loadRun(),loadAttendance(),loadReviews(),loadPayroll(),loadSummary()]);};
  const action=async(label:string,fn:()=>Promise<any>)=>{try{setBusy(label);setError('');await fn();await refreshAll();}catch(e){setError(errMessage(e))}finally{setBusy('')}};

  if(!run)return <div className="panel">Loading…<ErrorBox message={error}/></div>;

  const formatDate=(v:string)=>new Date(`${v}T00:00:00Z`).toLocaleDateString('en-IN',{timeZone:'UTC'});
  const formatTime=(v:string|null|undefined)=>v?new Date(v).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',timeZone:'UTC'}):'—';

  const employeeSummaries=summary?.employees||[];
  const visibleEmployeeSummaries=selectedEmployeeId ? employeeSummaries.filter((e:any)=>e.employeeId===selectedEmployeeId) : employeeSummaries;
  const payrollRows = showSelectedPayroll
    ? (payroll?.data || []).filter((r:any)=>selectedPayrollEmployees.includes(r.employeeId))
    : (payroll?.data || []);
  const payrollVisibleTotal = payrollRows.reduce((sum:number,r:any)=>sum+Number(r.payableAmount||0),0);
  const payrollAllIds = employeeSummaries.map((e:any)=>e.employeeId);
  const startPayrollEdit=(r:any)=>{
    setPayrollEditId(r.id);
    setPayrollDrafts(prev=>({...prev,[r.id]:{
      workingDays:r.workingDays,
      monthlyPayment:Number(r.grossSalary),
      perDay:Number(r.dailySalary),
      sdDeduction:Number(r.securityDeposit),
      securityDeposit:Number(r.securityDeposit),
      leave:Number(r.leaveDeductionAmount),
      penalty:Number(r.penalty),
      ptax:Number(r.ptax),
      payableAmount:Number(r.payableAmount),
      deductionLeave:Number(r.lateLeaveDeduction)+Number(r.excessLeaveDeduction)+Number(r.doubleDeductionLeave),
      halfDay:Number(r.halfDayCount||0),
      lateMark:Number(r.lateMarks),
      paidLeave:Number(r.paidLeaveAllowance),
      doubleDeductionLeave:Number(r.doubleDeductionLeave),
      totalLeave:Number(r.totalLeave),
      joinDate:r.joiningDate?r.joiningDate.slice(0,10):'',
      renewalDate:r.renewalDate||'',
      deposit:Number(r.heldSecurityDeposit||0),
      details:r.ruleSnapshot?.manualOverrides?.details || '',
      otherDeductions:Number(r.otherDeductions||0),
    }}));
  };
  const payrollDraft=(r:any)=>payrollDrafts[r.id] || {
    workingDays:r.workingDays, monthlyPayment:Number(r.grossSalary), perDay:Number(r.dailySalary),
    sdDeduction:Number(r.securityDeposit), securityDeposit:Number(r.securityDeposit), leave:Number(r.leaveDeductionAmount),
    penalty:Number(r.penalty), ptax:Number(r.ptax), payableAmount:Number(r.payableAmount),
    deductionLeave:Number(r.lateLeaveDeduction)+Number(r.excessLeaveDeduction)+Number(r.doubleDeductionLeave),
    halfDay:Number(r.halfDayCount||0), lateMark:Number(r.lateMarks), paidLeave:Number(r.paidLeaveAllowance),
    doubleDeductionLeave:Number(r.doubleDeductionLeave), totalLeave:Number(r.totalLeave),
    joinDate:r.joiningDate?r.joiningDate.slice(0,10):'', renewalDate:r.renewalDate||'',
    deposit:Number(r.heldSecurityDeposit||0), details:r.ruleSnapshot?.manualOverrides?.details || '', otherDeductions:Number(r.otherDeductions||0),
  };

  return <div>
    <div className="page-head">
      <div>
        <button onClick={()=>nav('/runs')}>← Runs</button>
        <h1>{monthName(run.month)} {run.year}</h1>
        <p>Status: <strong>{run.status}</strong></p>
      </div>
      <div className="actions">
        {run.status!=='FINALIZED'&&<button disabled={!!busy||!files.length} onClick={()=>action('upload',async()=>{const r=await api.uploadRun(id!,files);alert(JSON.stringify(r,null,2));setFiles([])})}>Upload</button>}
        {run.status!=='FINALIZED'&&<button disabled={!!busy} onClick={()=>action('process',()=>api.processRun(id!))}>Process Attendance</button>}
        {run.status!=='FINALIZED'&&<button disabled={!!busy} onClick={()=>action('calculate',()=>api.calculateRun(id!))}>Calculate Payroll</button>}
        {run.status==='REVIEW'&&
        <button
  disabled={!!busy}
  onClick={() => void action('export', () => api.exportRun(id!))}
>
  Export Excel
</button>}
        {['REVIEW','PROCESSING'].includes(run.status)&&<button disabled={!!busy} onClick={()=>action('finalize',()=>api.finalizeRun(id!))}>Finalize</button>}
        {run.status==='FINALIZED'&&<button disabled={!!busy} onClick={()=>action('reopen',()=>api.reopenRun(id!))}>Reopen</button>}
      </div>
    </div>
    <ErrorBox message={error}/>

    <section className="panel">
      <h3>Attendance Upload</h3>
      <input type="file" multiple accept=".zip,.xls,.xlsx,.csv" onChange={e=>setFiles(Array.from(e.target.files||[]))}/>
      <table><thead><tr><th>File</th><th>Status</th><th>Employee</th><th>Error</th><th>Action</th></tr></thead><tbody>
        {(run.files||[]).map((f:AttendanceFile)=><tr key={f.id}><td>{f.originalName}</td><td>{f.status}</td><td>{f.employeeCode||'—'}</td><td>{f.errorMessage||'—'}</td><td>{run.status!=='FINALIZED'&&<ConfirmButton onConfirm={()=>action('delete file',()=>api.deleteRunFile(id!,f.id))}>Delete</ConfirmButton>}</td></tr>)}
      </tbody></table>
    </section>

    <section className="panel">
      <div className="panel-head"><h3>Employee View</h3><span className="muted">Select one employee to reduce the run screen clutter.</span></div>
      <div className="employee-switcher">
        <button className={!selectedEmployeeId?'active':''} onClick={()=>{setSelectedEmployeeId('');setSelectedPayrollEmployees(payrollAllIds);setShowSelectedPayroll(false);setAttPage(1);setRevPage(1);setPayPage(1)}}>All Employees</button>
        {employeeSummaries.map((e:any)=><button key={e.employeeId} className={selectedEmployeeId===e.employeeId?'active':''} onClick={()=>{setSelectedEmployeeId(e.employeeId);setAttPage(1);setRevPage(1);setPayPage(1)}}>{e.employeeCode} — {e.employeeName}</button>)}
      </div>
    </section>

    <section className="panel">
      <div className="panel-head"><h3>Attendance</h3><PageSize value={pageSize} onChange={v=>{setPageSize(v);setAttPage(1)}}/></div>
      <div className="filters">
        <input placeholder="Employee" value={attFilter.search} onChange={e=>{setAttPage(1);setAttFilter({...attFilter,search:e.target.value})}}/>
        <select value={attFilter.status} onChange={e=>{setAttPage(1);setAttFilter({...attFilter,status:e.target.value})}}><option value="">All Status</option>{['PRESENT','ABSENT','STWI_LEAVE','HALF_DAY','HOLIDAY','WEEK_OFF','MANUAL_REVIEW'].map(s=><option key={s}>{s}</option>)}</select>
        <select value={attFilter.late} onChange={e=>{setAttPage(1);setAttFilter({...attFilter,late:e.target.value})}}><option value="">Late: All</option><option value="true">Late</option><option value="false">Not Late</option></select>
        <select value={attFilter.leave} onChange={e=>{setAttPage(1);setAttFilter({...attFilter,leave:e.target.value})}}><option value="">Leave: All</option><option value="true">Leave</option><option value="false">No Leave</option></select>
        <input type="date" value={attFilter.dateFrom} onChange={e=>setAttFilter({...attFilter,dateFrom:e.target.value})}/>
        <input type="date" value={attFilter.dateTo} onChange={e=>setAttFilter({...attFilter,dateTo:e.target.value})}/>
        <button onClick={()=>setAttFilter({search:'',status:'',late:'',leave:'',holiday:'',weekOff:'',manualReview:'',dateFrom:'',dateTo:''})}>Clear</button>
        <button onClick={async()=>{const employeeId=window.prompt('Employee ID (database id)');if(!employeeId)return;const workDate=window.prompt('Date YYYY-MM-DD');if(!workDate)return;await action('manual attendance',()=>api.addManualAttendance(id!,{employeeId,workDate,status:'PRESENT',workedHours:8,isLate:false}))}}>Add Manual</button>
      </div>
      {attendance?.data.length?<table><thead><tr><th>Date</th><th>Employee</th><th>Check-in</th><th>Hours</th><th>Status</th><th>Late</th><th>Leave</th><th>Actions</th></tr></thead><tbody>
        {attendance.data.map(a=><tr key={a.id}><td>{new Date(a.workDate).toLocaleDateString('en-IN',{timeZone:'UTC'})}</td><td>{a.employee.name}<small>{a.employee.employeeCode}</small></td><td>{formatTime(a.firstCheckIn)}</td><td>{a.workedHours??'—'}</td><td title={`System status: ${a.status}`}>{a.sourceStatus||a.status}</td><td>{a.isLate?'Yes':'No'} {a.lateMinutes?`(${a.lateMinutes}m)`:''}</td><td>{a.leaveFraction??'—'}</td><td>{run.status!=='FINALIZED'&&<><button onClick={async()=>{const status=window.prompt('Source Status',a.sourceStatus||a.status);if(!status)return;const leave=window.prompt('Leave fraction',String(a.leaveFraction||0));await action('update attendance',()=>api.updateAttendance(id!,a.id,{workDate:a.workDate,status:a.status,leaveFraction:Number(leave||0),workedHours:Number(a.workedHours||0),isLate:a.isLate,lateMinutes:a.lateMinutes,isHoliday:a.isHoliday,isWeekOff:a.isWeekOff,sourceStatus:status}))}}>Edit</button> <ConfirmButton onConfirm={()=>action('delete attendance',()=>api.deleteAttendance(id!,a.id))}>Delete</ConfirmButton></>}</td></tr>)}
      </tbody></table>:<div className="empty">No attendance records found.</div>}
      <PaginationControls pagination={attendance?.pagination} onChange={setAttPage}/>
    </section>

   
   <section className="panel">
  <div className="panel-head">
    <h3>Leave & Late Summary</h3>
    <span className="muted">
      Based on imported attendance records
    </span>
  </div>

  <div className="stats-grid two-column-summary">
    <div className="metric">
      <span>Leave</span>
      <strong>
        {summary?.employees
          ? visibleEmployeeSummaries.reduce(
              (sum: number, e: any) =>
                sum + Number(e.leaveDays || 0),
              0,
            )
          : 0}
      </strong>
    </div>

    <div className="metric">
      <span>Late Marks</span>
      <strong>
        {summary?.employees
          ? visibleEmployeeSummaries.reduce(
              (sum: number, e: any) =>
                sum + Number(e.lateMarkCount || 0),
              0,
            )
          : 0}
      </strong>
    </div>
  </div>

  {visibleEmployeeSummaries.map((e: any) => (
    <div className="summary-block" key={e.employeeId}>
      <h4>
        {e.employeeName}
        <small> ({e.employeeCode})</small>
      </h4>

      <div className="summary-columns">

        <div>
          <h4>Leave Dates</h4>

          {e.leaves?.length ? (
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Leave</th>
                  <th>Source Status</th>
                </tr>
              </thead>

              <tbody>
                {e.leaves.map((x: any) => (
                  <tr
                    key={`leave-${e.employeeId}-${x.date}`}
                  >
                    <td>{formatDate(x.date)}</td>
                    <td>{Number(x.leaveFraction)}</td>
                    <td>{x.sourceStatus || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty">No leave.</div>
          )}
        </div>

        <div>
          <h4>Late Mark Dates</h4>

          {e.lateMarks?.length ? (
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Check-in</th>
                  <th>Late By</th>
                  <th>Status</th>
                </tr>
              </thead>

              <tbody>
                {e.lateMarks.map((x: any) => (
                  <tr
                    key={`late-${e.employeeId}-${x.date}`}
                  >
                    <td>{formatDate(x.date)}</td>
                    <td>{formatTime(x.checkIn)}</td>
                    <td>{x.lateMinutes} min</td>
                    <td>{x.sourceStatus || x.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty">No late marks.</div>
          )}
        </div>

      </div>
    </div>
  ))}
</section>

    <section className="panel">
      <h3>Manual Review</h3>
      <div className="filters"><select value={revFilter.status} onChange={e=>{setRevPage(1);setRevFilter({...revFilter,status:e.target.value})}}><option value="">All</option><option value="OPEN">Open</option><option value="RESOLVED">Resolved</option><option value="REJECTED">Rejected</option></select><select value={revFilter.type} onChange={e=>setRevFilter({...revFilter,type:e.target.value})}><option value="">All Types</option>{['MISSING_CHECKIN','MISSING_CHECKOUT','AMBIGUOUS_LEAVE','EMPLOYEE_MISMATCH','UNEXPECTED_DURATION','OTHER'].map(x=><option key={x}>{x}</option>)}</select><input placeholder="Employee" value={revFilter.search} onChange={e=>setRevFilter({...revFilter,search:e.target.value})}/></div>
      {reviews?.data.length?<table><thead><tr><th>Status</th><th>Employee</th><th>Type</th><th>Description</th><th>Penalty</th><th>Double</th><th>Action</th></tr></thead><tbody>{reviews.data.map(r=><tr key={r.id}><td>{r.status}</td><td>{r.employee?.name||'—'}</td><td>{r.type}</td><td>{r.description}</td><td>{r.penaltyAmount??0}</td><td>{r.doubleDeductionLeave?'Yes':'No'}</td><td>{r.status==='OPEN'&&<button onClick={async()=>{const penalty=window.prompt('Penalty amount','0');if(penalty===null)return;const dd=window.confirm('Double Deduction Leave?');await action('resolve review',()=>api.resolveReview(r.id,{resolution:'Resolved in web app',penaltyAmount:Number(penalty||0),doubleDeductionLeave:dd}))}} >Resolve</button>} {r.status!=='RESOLVED'&&<ConfirmButton onConfirm={()=>action('delete review',()=>api.deleteReview(r.id))}>Delete</ConfirmButton>}</td></tr>)}</tbody></table>:<div className="empty">No reviews match.</div>}
      <PaginationControls pagination={reviews?.pagination} onChange={setRevPage}/>
    </section>

    <section className="panel">
      <div className="panel-head">
        <h3>Payroll Employee Selection</h3>
        <div className="actions">
          <label style={{display:'inline-flex',alignItems:'center',gap:6}}>
            <input type="checkbox" checked={showSelectedPayroll} onChange={e=>setShowSelectedPayroll(e.target.checked)} />
            Show selected only
          </label>
          <button onClick={()=>setSelectedPayrollEmployees(employeeSummaries.map((e:any)=>e.employeeId))}>Select All</button>
          <button onClick={()=>setSelectedPayrollEmployees([])}>Clear</button>
        </div>
      </div>
      <div className="employee-checkbox-grid">
        {employeeSummaries.map((e:any)=><label key={e.employeeId} style={{display:'inline-flex',alignItems:'center',gap:6,marginRight:14,marginBottom:8}}>
          <input type="checkbox" checked={selectedPayrollEmployees.includes(e.employeeId)} onChange={ev=>setSelectedPayrollEmployees(prev=>ev.target.checked?[...prev,e.employeeId]:prev.filter(x=>x!==e.employeeId))} />
          {e.employeeCode} — {e.employeeName}
        </label>)}
      </div>
      <div className="panel-head"><h3>Payroll Calculation</h3><span className="muted">Click Calculate Payroll above after all Manual Reviews are resolved.</span></div>
      {payroll?.data.length ? payroll.data.map((r:any)=>{const trace=r.ruleSnapshot?.calculationTrace||{}; return <div className="calculation-card" key={`calc-${r.employeeId}`}>
        <strong>{r.employee.name} ({r.employee.employeeCode})</strong>
        <div className="calculation-grid">
          <span>Gross Salary <b>{currency(r.grossSalary)}</b></span>
          <span>Calendar Days <b>{r.calendarDays}</b></span>
          <span>Per Day <b>{currency(trace.dailySalary ?? (Number(r.grossSalary)/Math.max(1,Number(r.calendarDays))))}</b></span>
          <span>Leave Taken <b>{Number(trace.leaveUsed ?? r.stwiLeaveDays)}</b></span>
          <span>Paid Leave <b>{Number(trace.paidLeaveAllowance ?? r.paidLeaveAllowance)}</b></span>
          <span>Late Marks <b>{r.lateMarks}</b></span>
          <span>Late → Leave <b>{Number(trace.lateLeaveDeduction ?? r.lateLeaveDeduction)}</b></span>
          <span>Total Deduction Leave <b>{Number(trace.totalDeductionLeave ?? (Number(r.lateLeaveDeduction)+Number(r.excessLeaveDeduction)+Number(r.doubleDeductionLeave)))}</b></span>
          <span>Attendance Deduction <b>{currency(trace.attendanceDeduction ?? 0)}</b></span>
          <span>P.Tax <b>{currency(r.ptax)}</b></span>
          <span>Security Deposit <b>{currency(r.securityDeposit)}</b></span>
          <span>Net Payable <b>{currency(r.payableAmount)}</b></span>
        </div>
      </div>}) : <div className="empty">Payroll has not been calculated yet.</div>}
      <p className="muted">Formula: Total Deduction Leave = max(0, Leave Taken + Late-Mark Leave + Double-Deduction Leave − Paid Leave). Per-day salary = Gross Salary ÷ actual calendar days in the month. Half-day leave = 0.5 × daily salary. P.Tax = ₹200 when Gross Salary &gt; ₹12,000.</p>
    </section>

    <section className="panel">
      <div className="panel-head">
        <div>
          <h3>Payroll Review</h3>
          <span className="muted">Every payroll value shown here can be manually adjusted and saved for the selected employee.</span>
        </div>
        <PageSize value={pageSize} onChange={v=>{setPageSize(v);setPayPage(1)}}/>
      </div>
      <div className="stats-grid two-column-summary">
        <div className="metric"><span>Employees Shown</span><strong>{payrollRows.length}</strong></div>
        <div className="metric"><span>Total Final Payable</span><strong>{currency(payrollVisibleTotal)}</strong></div>
      </div>
      <div className="filters">
        <input placeholder="Employee" value={payFilter.search} onChange={e=>setPayFilter({...payFilter,search:e.target.value})}/>
        <select value={payFilter.hasLate} onChange={e=>setPayFilter({...payFilter,hasLate:e.target.value})}><option value="">Late: All</option><option value="true">Late</option><option value="false">No Late</option></select>
        <select value={payFilter.hasLeave} onChange={e=>setPayFilter({...payFilter,hasLeave:e.target.value})}><option value="">Leave: All</option><option value="true">Has Leave</option><option value="false">No Leave</option></select>
        <input placeholder="Min payable" type="number" value={payFilter.minPayable} onChange={e=>setPayFilter({...payFilter,minPayable:e.target.value})}/>
        <input placeholder="Max payable" type="number" value={payFilter.maxPayable} onChange={e=>setPayFilter({...payFilter,maxPayable:e.target.value})}/>
        <button onClick={()=>setPayFilter({search:'',hasLate:'',hasLeave:'',hasPenalty:'',hasPtax:'',hasSecurityDeposit:'',minGross:'',maxGross:'',minPayable:'',maxPayable:''})}>Clear</button>
      </div>
      {payrollRows.length?<div className="table-scroll"><table><thead><tr>
        <th>Employee</th><th>Working Days</th><th>Monthly Payment</th><th>Per Day</th><th>SD Deduction</th><th>Security Deposit</th><th>Leave</th><th>Penalty</th><th>P.Tax</th><th>Payable AMT</th><th>Deduction Leave</th><th>Half Day</th><th>Late Mark</th><th>Paid Leave</th><th>Double Deduction Leave</th><th>Total Leave</th><th>Join Date</th><th>Renewal Date</th><th>Deposit</th><th>Details</th><th>Action</th>
      </tr></thead><tbody>{payrollRows.map((r:any)=>{
        const trace=r.ruleSnapshot?.calculationTrace||{};
        const d=payrollDraft(r);
        const editing=payrollEditId===r.id;
        const setD=(key:string,value:any)=>setPayrollDrafts(prev=>({...prev,[r.id]:{...d,[key]:value}}));
        return <>
          <tr key={r.id}>
            <td><strong>{r.employee.name}</strong><small>{r.employee.employeeCode}</small></td>
            <td>{Number(d.workingDays)}</td>
            <td>{currency(d.monthlyPayment)}</td>
            <td>{currency(d.perDay)}</td>
            <td>{currency(d.sdDeduction)}</td>
            <td>{currency(d.securityDeposit)}</td>
            <td>{currency(d.leave)}</td>
            <td>{currency(d.penalty)}</td>
            <td>{currency(d.ptax)}</td>
            <td><strong>{currency(d.payableAmount)}</strong></td>
            <td>{Number(d.deductionLeave)}</td>
            <td>{Number(d.halfDay)}</td>
            <td>{Number(d.lateMark)}</td>
            <td>{Number(d.paidLeave)}</td>
            <td>{Number(d.doubleDeductionLeave)}</td>
            <td>{Number(d.totalLeave)}</td>
            <td>{d.joinDate?formatDate(d.joinDate):'—'}</td>
            <td>{d.renewalDate?formatDate(d.renewalDate):'—'}</td>
            <td>{currency(d.deposit)}</td>
            <td><small>{d.details || `Gross ${currency(r.grossSalary)} | Leave ${Number(trace.leaveUsed ?? r.stwiLeaveDays)} | Late ${r.lateMarks} | Paid ${Number(r.paidLeaveAllowance)} | P.Tax ${currency(r.ptax)}`}</small></td>
            <td>
              <button onClick={()=>editing?setPayrollEditId(null):startPayrollEdit(r)}>{editing?'Close':'Edit'}</button>{' '}
              <button onClick={async()=>{const method=window.confirm('OK = FULL, Cancel = EMI (3 months)');await action('deposit',()=>api.setDepositMethod(id!,r.employeeId,method?'FULL':'EMI_3_MONTHS'))}}>Deposit</button>{' '}
              <button onClick={()=>{if(window.confirm('Undo the selected security deposit for this employee?')) void action('reset deposit',()=>api.resetDepositMethod(id!,r.employeeId))}}>Undo</button>
            </td>
          </tr>
          {editing&&<tr key={`${r.id}-edit`}><td colSpan={21}>
            <div className="payroll-editor">
              <label>Working Days<input type="number" step="0.01" value={d.workingDays} onChange={e=>setD('workingDays',e.target.value)}/></label>
              <label>Monthly Payment<input type="number" step="0.01" value={d.monthlyPayment} onChange={e=>setD('monthlyPayment',e.target.value)}/></label>
              <label>Per Day<input type="number" step="0.01" value={d.perDay} onChange={e=>setD('perDay',e.target.value)}/></label>
              <label>SD Deduction<input type="number" step="0.01" value={d.sdDeduction} onChange={e=>{const value=e.target.value;setPayrollDrafts(prev=>({...prev,[r.id]:{...d,sdDeduction:value,securityDeposit:value}}))}}/></label>
              <label>Security Deposit<input type="number" step="0.01" value={d.securityDeposit} onChange={e=>setD('securityDeposit',e.target.value)}/></label>
              <label>Leave<input type="number" step="0.01" value={d.leave} onChange={e=>setD('leave',e.target.value)}/></label>
              <label>Penalty<input type="number" step="0.01" value={d.penalty} onChange={e=>setD('penalty',e.target.value)}/></label>
              <label>P.Tax<input type="number" step="0.01" value={d.ptax} onChange={e=>setD('ptax',e.target.value)}/></label>
              <label>Payable AMT<input type="number" step="0.01" value={d.payableAmount} onChange={e=>setD('payableAmount',e.target.value)}/></label>
              <label>Deduction Leave<input type="number" step="0.01" value={d.deductionLeave} onChange={e=>setD('deductionLeave',e.target.value)}/></label>
              <label>Half Day<input type="number" step="0.01" value={d.halfDay} onChange={e=>setD('halfDay',e.target.value)}/></label>
              <label>Late Mark<input type="number" step="1" value={d.lateMark} onChange={e=>setD('lateMark',e.target.value)}/></label>
              <label>Paid Leave<input type="number" step="0.01" value={d.paidLeave} onChange={e=>setD('paidLeave',e.target.value)}/></label>
              <label>Double Deduction Leave<input type="number" step="0.01" value={d.doubleDeductionLeave} onChange={e=>setD('doubleDeductionLeave',e.target.value)}/></label>
              <label>Total Leave<input type="number" step="0.01" value={d.totalLeave} onChange={e=>setD('totalLeave',e.target.value)}/></label>
              <label>Join Date<input type="date" value={d.joinDate} onChange={e=>setD('joinDate',e.target.value)}/></label>
              <label>Renewal Date<input type="date" value={d.renewalDate} onChange={e=>setD('renewalDate',e.target.value)}/></label>
              <label>Deposit<input type="number" step="0.01" value={d.deposit} onChange={e=>setD('deposit',e.target.value)}/></label>
              <label>Other Deduction<input type="number" step="0.01" value={d.otherDeductions} onChange={e=>setD('otherDeductions',e.target.value)}/></label>
              <label className="wide">Details<input value={d.details} onChange={e=>setD('details',e.target.value)}/></label>
              <div className="editor-actions">
                <button onClick={async () => {
                  await action('edit payroll', () => api.updatePayrollResult(id!, r.employeeId, {
                    grossSalary: Number(d.monthlyPayment),
                    paidLeaveAllowance: Number(d.paidLeave),
                    lateMarks: Number(d.lateMark),
                    lateLeaveDeduction: Number(d.deductionLeave),
                    excessLeaveDeduction: 0,
                    doubleDeductionLeave: Number(d.doubleDeductionLeave),
                    penalty: Number(d.penalty),
                    securityDeposit: Number(d.securityDeposit),
                    ptax: Number(d.ptax),
                    otherDeductions: Number(d.otherDeductions),
                    payableAmount: Number(d.payableAmount),
                    workingDays: Number(d.workingDays),
                    dailySalary: Number(d.perDay),
                    leaveDeductionAmount: Number(d.leave),
                    halfDayCount: Number(d.halfDay),
                    totalLeave: Number(d.totalLeave),
                    renewalDate: d.renewalDate || null,
                    heldSecurityDeposit: Number(d.deposit),
                    details: d.details || '',
                    joinDate: d.joinDate || null,
                  }));
                  setPayrollEditId(null);
                }}>Save Changes</button>
                <button onClick={() => setPayrollEditId(null)}>Cancel</button>
              </div>
            </div>
          </td></tr>}
        </>;
      })}</tbody></table></div>:<div className="empty">Calculate payroll after processing and resolving reviews.</div>}
      <PaginationControls pagination={payroll?.pagination} onChange={setPayPage}/>
    </section>

    <section className="panel"><h3>Files &amp; Actions</h3><p>Open reviews: {reviews?.pagination.total??0}</p><div className="actions">
      <button
  disabled={!!busy}
  onClick={() => void action('export', () => api.exportRun(id!))}
>
  Export Excel
</button>
      {run.status==='FINALIZED'?<button onClick={()=>action('reopen',()=>api.reopenRun(id!))}>Reopen</button>:<button onClick={()=>action('finalize',()=>api.finalizeRun(id!))}>Finalize</button>}</div></section>
  </div>
}
function Reviews(){const[runs,setRuns]=useState<Page<Run>>();const[runId,setRunId]=useState('');const[page,setPage]=useState(1);const[pageSize,setPageSize]=useState(25);const[reviews,setReviews]=useState<Page<Review>>();const[filters,setFilters]=useState({status:'OPEN',type:'',search:'',penaltyPresent:'',doubleDeductionLeave:''});useEffect(()=>{api.runs({page:1,pageSize:100}).then(r=>{setRuns(r);if(!runId&&r.data[0])setRunId(r.data[0].id)}).catch(()=>{})},[]);useEffect(()=>{if(runId)api.reviews(runId,{...filters,page,pageSize}).then(setReviews).catch(()=>{})},[runId,page,pageSize,JSON.stringify(filters)]);return <div><div className="page-head"><div><h1>Manual Review</h1><p>Review exceptions across a selected run.</p></div></div><div className="panel"><div className="filters"><select value={runId} onChange={e=>{setRunId(e.target.value);setPage(1)}}>{runs?.data.map(r=><option key={r.id} value={r.id}>{monthName(r.month)} {r.year}</option>)}</select><select value={filters.status} onChange={e=>setFilters({...filters,status:e.target.value})}><option value="">All</option><option value="OPEN">Open</option><option value="RESOLVED">Resolved</option><option value="REJECTED">Rejected</option></select><select value={filters.type} onChange={e=>setFilters({...filters,type:e.target.value})}><option value="">All Types</option>{['MISSING_CHECKIN','MISSING_CHECKOUT','AMBIGUOUS_LEAVE','EMPLOYEE_MISMATCH','UNEXPECTED_DURATION','OTHER'].map(x=><option key={x}>{x}</option>)}</select><input placeholder="Search employee" value={filters.search} onChange={e=>setFilters({...filters,search:e.target.value})}/><PageSize value={pageSize} onChange={v=>{setPageSize(v);setPage(1)}}/></div>{reviews?.data.length?<table><thead><tr><th>Status</th><th>Employee</th><th>Type</th><th>Description</th><th>Action</th></tr></thead><tbody>{reviews.data.map(r=><tr key={r.id}><td>{r.status}</td><td>{r.employee?.name||'—'}</td><td>{r.type}</td><td>{r.description}</td><td>{r.status==='OPEN'&&<button onClick={()=>api.resolveReview(r.id,{resolution:'Resolved in web app',penaltyAmount:0,doubleDeductionLeave:false}).then(()=>api.reviews(runId,{...filters,page,pageSize}).then(setReviews))}>Resolve</button>} {r.status!=='RESOLVED'&&<button onClick={()=>{if(window.confirm('Delete this review?'))api.deleteReview(r.id).then(()=>api.reviews(runId,{...filters,page,pageSize}).then(setReviews))}}>Delete</button>}</td></tr>)}</tbody></table>:<div className="empty">No reviews.</div>}<PaginationControls pagination={reviews?.pagination} onChange={setPage}/></div></div>}
function Settings(){const[rules,setRules]=useState<any[]>([]);const[search,setSearch]=useState('');const[error,setError]=useState('');useEffect(()=>{api.rules().then(setRules).catch(e=>setError(errMessage(e)))},[]);return <div><div className="page-head"><div><h1>Rule Management</h1><p>Versioned business rules.</p></div></div><ErrorBox message={error}/><div className="panel"><div className="filters"><input placeholder="Search rule" value={search} onChange={e=>setSearch(e.target.value)}/></div><table><thead><tr><th>Rule</th><th>Value</th><th>Effective</th><th></th></tr></thead><tbody>{rules.filter(r=>String(r.key).toLowerCase().includes(search.toLowerCase())||String(r.value).toLowerCase().includes(search.toLowerCase())).map(r=><RuleRow key={r.key} rule={r}/>)}</tbody></table></div></div>}
function RuleRow({rule}:{rule:any}){const[value,setValue]=useState(String(rule.value));const[saved,setSaved]=useState(false);return <tr><td>{rule.key}</td><td><input value={value} onChange={e=>{setValue(e.target.value);setSaved(false)}}/></td><td>{new Date(rule.effectiveFrom).toLocaleDateString('en-IN')}</td><td><button onClick={async()=>{await api.updateRule(rule.key,value);setSaved(true)}}>{saved?'Saved':'Save'}</button></td></tr>}
function Payroll(){const nav=useNavigate();const[runs,setRuns]=useState<Page<Run>>();const[page,setPage]=useState(1);const[pageSize,setPageSize]=useState(25);const[filters,setFilters]=useState({year:'',month:'',status:'',search:''});useEffect(()=>{api.runs({...filters,page,pageSize}).then(setRuns).catch(()=>{})},[page,pageSize,JSON.stringify(filters)]);return <div><div className="page-head"><div><h1>Payroll</h1><p>Open a run to review payroll and export.</p></div></div><div className="panel"><div className="filters"><input placeholder="Search year" value={filters.search} onChange={e=>setFilters({...filters,search:e.target.value})}/><select value={filters.year} onChange={e=>setFilters({...filters,year:e.target.value})}><option value="">All Years</option>{Array.from({length:7},(_,i)=>String(new Date().getFullYear()-i)).map(y=><option key={y}>{y}</option>)}</select><select value={filters.month} onChange={e=>setFilters({...filters,month:e.target.value})}><option value="">All Months</option>{Array.from({length:12},(_,i)=><option key={i+1} value={i+1}>{monthName(i+1)}</option>)}</select><select value={filters.status} onChange={e=>setFilters({...filters,status:e.target.value})}><option value="">All Statuses</option>{['DRAFT','PROCESSING','REVIEW','FINALIZED','REOPENED'].map(x=><option key={x}>{x}</option>)}</select><PageSize value={pageSize} onChange={v=>{setPageSize(v);setPage(1)}}/></div>{runs?.data.map(r=><div className="card" key={r.id}><strong>{monthName(r.month)} {r.year}</strong><span>{r.status}</span><button onClick={()=>nav(`/runs/${r.id}`)}>Open</button></div>)}<PaginationControls pagination={runs?.pagination} onChange={setPage}/></div></div>}

function App(){
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (token) {
      api.me()
        .then((u) => {
          setUser(u);
          setLoading(false);
        })
        .catch(() => {
          localStorage.removeItem('accessToken');
          setUser(null);
          setLoading(false);
        });
    } else {
      setLoading(false);
    }
  }, []);

  if (loading) {
    return <div className="login-wrap">Loading…</div>;
  }

  if (!user) {
    return <Login onLogin={setUser} />;
  }

  return <div className="app"><aside><div className="brand">STWI</div><div className="userbox"><strong>{user.name}</strong><span>{user.role}</span></div><nav><Link to="/">Dashboard</Link><Link to="/employees">Employees</Link><Link to="/runs">Monthly Run</Link><Link to="/reviews">Manual Review</Link><Link to="/payroll">Payroll</Link><Link to="/settings">Rules</Link></nav><button className="logout" onClick={()=>{localStorage.removeItem('accessToken');setUser(null)}}>Logout</button></aside><main><Routes><Route path="/" element={<Dashboard user={user}/>}/><Route path="/employees" element={<Employees/>}/><Route path="/employees/:id" element={<EmployeeDetail/>}/><Route path="/runs" element={<Runs/>}/><Route path="/runs/:id" element={<RunDetail/>}/><Route path="/reviews" element={<Reviews/>}/><Route path="/payroll" element={<Payroll/>}/><Route path="/settings" element={<Settings/>}/><Route path="*" element={<Navigate to="/" replace/>}/></Routes></main></div>}

export default App;
