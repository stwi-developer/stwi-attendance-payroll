import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import stwiLogo from './assets/stwi-logo.webp';
import { api, AttendanceFile, AttendanceRecord, Employee, Page, PayrollResult, Review, Run, User } from './api';
import { dialog, DialogHost } from './ui/dialog';
import { DEFAULT_LABELS, L, labelOverrides, setLabelOverrides } from './ui/labels';
import { currency, errMessage, monthName, PageSize, PaginationControls } from './ui/common';
import { EmployeeDetail, EmployeeNew, EmployeesList } from './employees/pages';
import { ImportPage } from './employees/ImportPage';
import { DateInput } from './ui/DateInput';
import { fmtDate, fmtHours, fmtText, fmtTime } from './ui/date';
import { busy as blocking, BusyHost, LoadingBar, LoadingBlock } from './ui/loading';


// V1.7: one resolve dialog for both review screens. For reviews about a single
// day, HR decides the leave for that day (0 / 0.5 / 1); it is written to the
// attendance row and used by payroll.
const DAY_REVIEW_TYPES=['MISSING_CHECKIN','MISSING_CHECKOUT','AMBIGUOUS_LEAVE','UNEXPECTED_DURATION'];
async function askReviewResolution(r:Review):Promise<any|null>{
  const dayReview=DAY_REVIEW_TYPES.includes(r.type);
  const v=await dialog.form({title:L('rev.resolve.title'),message:r.description,submitLabel:L('rev.btn.resolve'),fields:[
    ...(dayReview?[{name:'leave',label:L('rev.leave.label'),type:'radio' as const,default:'',options:[{value:'',label:L('rev.leave.keep')},{value:'0',label:L('rev.leave.0')},{value:'0.5',label:L('rev.leave.half')},{value:'1',label:L('rev.leave.1')}]}]:[]),
    {name:'penalty',label:L('rev.penalty.label'),type:'number',min:0,default:'0'},
    {name:'ddl',label:L('rev.ddl.label'),type:'checkbox',default:false},
  ]});
  if(!v)return null;
  const payload:any={resolution:'Resolved in web app',penaltyAmount:Number(v.penalty||0),doubleDeductionLeave:!!v.ddl};
  if(dayReview&&v.leave!=='')payload.leaveFraction=Number(v.leave);
  return payload;
}

// V1.9: errors are shown as popups. setError(msg) opens the popup; ErrorBox is kept so old screens need no change.
function useErrorPopup(){const set=(m:string)=>{if(m)void dialog.error(m)};return ['',set] as const}
function ErrorBox(_:{message:string}){return null}
function ConfirmButton({children,onConfirm,disabled=false,title,message,small}:{children:any;onConfirm:()=>void;disabled?:boolean;title?:string;message?:string;small?:boolean}){return <button className={`btn-secondary${small?' btn-xs':''}`} disabled={disabled} onClick={async()=>{if(await dialog.confirm({tone:'danger',title:title??L('popup.delete.title'),message:message??L('popup.confirm.message'),confirmLabel:L('btn.delete')}))onConfirm()}}>{children}</button>}

function Login({onLogin}:{onLogin:(u:User)=>void}){const nav=useNavigate();const[email,setEmail]=useState('');const[password,setPassword]=useState('');const[showPw,setShowPw]=useState(false);const[signingIn,setSigningIn]=useState(false);const[error,setError]=useErrorPopup();return <div className="login-wrap"><form className="login-card" onSubmit={async e=>{e.preventDefault();setSigningIn(true);try{const r=await api.login(email,password);localStorage.setItem('accessToken',r.accessToken);onLogin(r.user);nav('/')}catch(err){setError(errMessage(err))}finally{setSigningIn(false)}}}><img className="login-logo" src={stwiLogo} alt="STWI"/><h1>STWI Attendance &amp; Payroll</h1><p>Internal HR &amp; Payroll</p><label>Email<input value={email} onChange={e=>setEmail(e.target.value)}/></label><label>Password<span className="pw-wrap"><input type={showPw?'text':'password'} value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password"/><button type="button" className="pw-eye" onClick={()=>setShowPw(v=>!v)} aria-label={showPw?'Hide password':'Show password'} title={showPw?'Hide password':'Show password'}>{showPw?<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M2.1 3.5 3.5 2.1l18.4 18.4-1.4 1.4-3.2-3.2A11 11 0 0 1 12 20C6.5 20 2.7 16.1 1 12c.8-1.9 2.1-3.7 3.8-5.1L2.1 3.5zM12 6c-.9 0-1.8.1-2.6.4L7.8 4.8A11 11 0 0 1 12 4c5.5 0 9.3 3.9 11 8-.7 1.6-1.7 3.1-3 4.3l-1.4-1.4c.9-.8 1.7-1.8 2.2-2.9C19.2 8.8 16 6 12 6zm0 3a3 3 0 0 1 3 3l-.1.7-3.6-3.6.7-.1zm-3 3 3 3a3 3 0 0 1-3-3z"/></svg>:<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 4c5.5 0 9.3 3.9 11 8-1.7 4.1-5.5 8-11 8S2.7 16.1 1 12c1.7-4.1 5.5-8 11-8zm0 2c-4 0-7.2 2.8-8.8 6 1.6 3.2 4.8 6 8.8 6s7.2-2.8 8.8-6C19.2 8.8 16 6 12 6zm0 2.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z"/></svg>}</button></span></label><ErrorBox message={error}/><button disabled={signingIn}>{signingIn?'Signing in…':L('btn.signIn')}</button></form></div>}
function Dashboard({user}:{user:User}){const[data,setData]=useState<any>();const[error,setError]=useErrorPopup();useEffect(()=>{api.dashboard().then(setData).catch(e=>setError(errMessage(e)))},[]);return <div><div className="page-head"><div><h1>Dashboard</h1><p>Welcome, {user.name} · {user.role}</p></div></div><ErrorBox message={error}/><div className="stats-grid">
  <Link className="metric metric-link" to="/employees" title="Open Employees"><span>Active Employees</span><strong>{data?data.employees:'…'}</strong><small>Open Employees →</small></Link>
  <Link className="metric metric-link" to="/runs" title="Open Monthly Run"><span>Latest Run</span><strong>{!data?'…':data.latestRun?`${monthName(data.latestRun.month)} ${data.latestRun.year}`:'—'}</strong><small>{data?.latestRun?.status||(data?'No run yet':'')} · Open Monthly Run →</small></Link>
  <Link className="metric metric-link" to="/reviews" title="Open Manual Review"><span>Open Reviews</span><strong>{data?(data.latestRun?.reviewsOpen??0):'…'}</strong><small>Latest run · Open Manual Review →</small></Link>
  <Link className="metric metric-link" to="/payroll" title="Open Payroll"><span>Payroll Results</span><strong>{data?(data.finalizedRuns??0):'…'}</strong><small>Finalized months · Open Payroll →</small></Link>
</div><div className="grid"><Link className="card" to="/employees"><strong>Employees</strong><span>Master data, salary and deposit.</span></Link><Link className="card" to="/runs"><strong>Monthly Run</strong><span>Upload, process, review and calculate.</span></Link><Link className="card" to="/reviews"><strong>Manual Review</strong><span>Resolve attendance exceptions.</span></Link><Link className="card" to="/payroll"><strong>Payroll</strong><span>Review, export and finalize.</span></Link></div></div>}

function Runs(){const nav=useNavigate();const now=new Date();const[result,setResult]=useState<Page<Run>|null>();const[page,setPage]=useState(1);const[pageSize,setPageSize]=useState(25);const[filters,setFilters]=useState({year:'',month:'',status:'',search:''});const[year,setYear]=useState(String(now.getFullYear()));const[month,setMonth]=useState(String(now.getMonth()+1));const[error,setError]=useErrorPopup();const load=()=>api.runs({...filters,page,pageSize}).then(setResult).catch(e=>setError(errMessage(e)));useEffect(()=>{void load()},[page,pageSize,JSON.stringify(filters)]);return <div><div className="page-head"><div><h1>Monthly Runs</h1><p>Upload → Process → Manual Review → Calculate → Finalize.</p></div></div><ErrorBox message={error}/><div className="split"><form className="panel" onSubmit={async e=>{e.preventDefault();try{const r=await api.createRun(Number(year),Number(month));nav(`/runs/${r.id}`)}catch(err){setError(errMessage(err))}}}><h3>Create Monthly Run</h3><label>Year<input type="number" value={year} onChange={e=>setYear(e.target.value)}/></label><label>Month<select value={month} onChange={e=>setMonth(e.target.value)}>{Array.from({length:12},(_,i)=><option key={i+1} value={i+1}>{monthName(i+1)}</option>)}</select></label><button>{L('run.btn.create')}</button></form><div className="panel"><div className="panel-head"><h3>Run History</h3><PageSize value={pageSize} onChange={v=>{setPageSize(v);setPage(1)}}/></div><div className="filters"><input placeholder="Search year" value={filters.search} onChange={e=>setFilters({...filters,search:e.target.value})}/><select value={filters.year} onChange={e=>setFilters({...filters,year:e.target.value})}><option value="">All Years</option>{Array.from({length:7},(_,i)=>String(now.getFullYear()-i)).map(y=><option key={y}>{y}</option>)}</select><select value={filters.month} onChange={e=>setFilters({...filters,month:e.target.value})}><option value="">All Months</option>{Array.from({length:12},(_,i)=><option key={i+1} value={i+1}>{monthName(i+1)}</option>)}</select><select value={filters.status} onChange={e=>setFilters({...filters,status:e.target.value})}><option value="">All Statuses</option>{['DRAFT','PROCESSING','REVIEW','FINALIZED','REOPENED'].map(s=><option key={s}>{s}</option>)}</select><button onClick={()=>setFilters({year:'',month:'',status:'',search:''})}>{L('btn.clear')}</button></div>{result===undefined?<LoadingBlock/>:result?.data.length?<table><thead><tr><th>Month</th><th>Status</th><th>Files</th><th>Reviews</th><th>Payroll</th><th>Action</th></tr></thead><tbody>{result.data.map(r=><tr key={r.id}><td>{monthName(r.month)} {r.year}</td><td>{r.status}</td><td>{r._count?.files??0}</td><td>{r._count?.manualReviews??0}</td><td>{r._count?.payrollResults??0}</td><td><button onClick={()=>nav(`/runs/${r.id}`)}>{L('btn.open')}</button> <ConfirmButton title={L('run.delete.title')} message={L('run.delete.message')} onConfirm={async()=>{try{await api.deleteRun(r.id);await load()}catch(err){setError(errMessage(err))}}}>{L('btn.delete')}</ConfirmButton></td></tr>)}</tbody></table>:<div className="empty">No runs found.</div>}<PaginationControls pagination={result?.pagination} onChange={setPage}/></div></div></div>}

function RunDetail(){
  const{id}=useParams();
  const nav=useNavigate();
  const[run,setRun]=useState<Run|null>();
  const[error,setError]=useErrorPopup();
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
  // V1.9: every action ends with an STWI popup (success or error)
  const LONG:Record<string,string>={upload:'Uploading attendance files…',process:'Processing attendance…',calculate:'Calculating payroll…',export:'Preparing the Excel file…',finalize:'Finalizing the month…',reopen:'Reopening the month…'};
  const action=async(label:string,fn:()=>Promise<any>,quiet=false)=>{let ok=false;try{setBusy(label);const work=async()=>{await fn();ok=true;await refreshAll()};if(LONG[label])await blocking.run(LONG[label],work);else await work();}catch(e){setBusy('');await dialog.error(errMessage(e));return}finally{setBusy('')}if(ok&&!quiet)await dialog.success(L(`run.done.${label.replace(/ /g,'_')}`))};
  const confirmThen=async(title:string,message:string,label:string,fn:()=>Promise<any>)=>{if(await dialog.confirm({title,message,confirmLabel:L(`run.btn.${label}`)}))await action(label,fn)};
  const addManual=async()=>{
    let list:Employee[]=[];try{list=(await api.employees({status:'ACTIVE',pageSize:100})).data}catch(e){await dialog.error(errMessage(e));return}
    const v=await dialog.form({title:L('run.manual.title'),submitLabel:L('btn.save'),fields:[
      {name:'employeeId',label:'Employee',type:'select',required:true,options:list.map(e=>({value:e.id,label:`${e.name} (${e.employeeCode})`}))},
      {name:'workDate',label:'Date',type:'date',required:true,default:`${run!.year}-${String(run!.month).padStart(2,'0')}-01`},
      {name:'workedHours',label:'Hours worked',type:'number',min:0,max:24,default:'8'},
      {name:'isLate',label:'Late mark',type:'checkbox',default:false},
    ]});
    if(!v)return;
    await action('manual attendance',()=>api.addManualAttendance(id!,{employeeId:v.employeeId,workDate:v.workDate,status:'PRESENT',workedHours:Number(v.workedHours||0),isLate:!!v.isLate}));
  };
  const editAttendance=async(a:AttendanceRecord)=>{
    const v=await dialog.form({title:L('run.editAtt.title'),message:`${a.employee.name} · ${fmtDate(a.workDate)}`,submitLabel:L('btn.save'),fields:[
      {name:'sourceStatus',label:'Status (as in Zoho)',type:'text',required:true,default:a.sourceStatus||a.status},
      {name:'leave',label:'Leave for this day',type:'radio',default:String(Number(a.leaveFraction||0)),options:[{value:'0',label:L('rev.leave.0')},{value:'0.5',label:L('rev.leave.half')},{value:'1',label:L('rev.leave.1')}]},
    ]});
    if(!v)return;
    await action('update attendance',()=>api.updateAttendance(id!,a.id,{workDate:a.workDate,status:a.status,leaveFraction:Number(v.leave||0),isLate:a.isLate,lateMinutes:a.lateMinutes,isHoliday:a.isHoliday,isWeekOff:a.isWeekOff,sourceStatus:v.sourceStatus}));
  };
  const showUpload=async(r:any[])=>{
    const cls=(st:string)=>st==='READY'?'ok':st==='DUPLICATE'?'muted':st==='MISMATCH'?'warn':'bad';
    await dialog.alert(<table className="result-table"><thead><tr><th>File</th><th>ID</th><th>Result</th></tr></thead><tbody>{(r||[]).map((x:any,i:number)=><tr key={i}><td>{x.file}</td><td>{x.employeeCode||'—'}</td><td><span className={`badge ${cls(x.status)}`}>{x.status}</span>{x.imported?<small> {x.imported} rows</small>:null}{x.error?<div className="muted">{x.error}</div>:null}</td></tr>)}</tbody></table>,{title:L('run.upload.title'),tone:(r||[]).every((x:any)=>x.status==='READY')?'success':'warning',wide:true});
  };

  if(!run)return <div className="panel">Loading…<ErrorBox message={error}/></div>;

  const formatDate=(v:string)=>fmtDate(v);
  const formatTime=(v:string|null|undefined)=>fmtTime(v);

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
      deductionLeave:Number(r.deductionLeave??0),
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
  const payrollDraft=(r:any)=>(!r.__fresh&&payrollDrafts[r.id]) || {
    workingDays:r.workingDays, monthlyPayment:Number(r.grossSalary), perDay:Number(r.dailySalary),
    sdDeduction:Number(r.securityDeposit), securityDeposit:Number(r.securityDeposit), leave:Number(r.leaveDeductionAmount),
    penalty:Number(r.penalty), ptax:Number(r.ptax), payableAmount:Number(r.payableAmount),
    deductionLeave:Number(r.deductionLeave??0),
    halfDay:Number(r.halfDayCount||0), lateMark:Number(r.lateMarks), paidLeave:Number(r.paidLeaveAllowance),
    doubleDeductionLeave:Number(r.doubleDeductionLeave), totalLeave:Number(r.totalLeave),
    joinDate:r.joiningDate?r.joiningDate.slice(0,10):'', renewalDate:r.renewalDate||'',
    deposit:Number(r.heldSecurityDeposit||0), details:r.ruleSnapshot?.manualOverrides?.details || '', otherDeductions:Number(r.otherDeductions||0),
  };

  return <div>
    <div className="page-head">
      <div>
        <button onClick={()=>nav('/runs')}>{L('run.btn.backToRuns')}</button>
        <h1>{monthName(run.month)} {run.year}</h1>
        <p>Status: <strong>{run.status}</strong></p>
      </div>
      <div className="actions">
        {run.status!=='FINALIZED'&&<button disabled={!!busy||!files.length} onClick={async()=>{let r:any[]|null=null;await action('upload',async()=>{r=await api.uploadRun(id!,files);setFiles([])},true);if(r)await showUpload(r)}}>{L('run.btn.upload')}</button>}
        {run.status!=='FINALIZED'&&<button disabled={!!busy} onClick={()=>action('process',()=>api.processRun(id!))}>{L('run.btn.process')}</button>}
        {run.status!=='FINALIZED'&&<button disabled={!!busy} onClick={()=>action('calculate',()=>api.calculateRun(id!))}>{L('run.btn.calculate')}</button>}
        {run.status==='REVIEW'&&
        <button
  disabled={!!busy}
  onClick={() => void action('export', () => api.exportRun(id!))}
>
  {L('run.btn.export')}
</button>}
        {['REVIEW','PROCESSING'].includes(run.status)&&<button disabled={!!busy} onClick={()=>confirmThen(L('run.finalize.title'),L('run.finalize.message'),'finalize',()=>api.finalizeRun(id!))}>{L('run.btn.finalize')}</button>}
        {run.status==='FINALIZED'&&<button disabled={!!busy} onClick={()=>confirmThen(L('run.reopen.title'),L('run.reopen.message'),'reopen',()=>api.reopenRun(id!))}>{L('run.btn.reopen')}</button>}
      </div>
    </div>
    <ErrorBox message={error}/>

    <section className="panel">
      <h3>Attendance Upload</h3>
      <input type="file" multiple accept=".zip,.xls,.xlsx,.csv" onChange={e=>setFiles(Array.from(e.target.files||[]))}/>
      <table><thead><tr><th>File</th><th>Status</th><th>Employee</th><th>Error</th><th>Action</th></tr></thead><tbody>
        {(run.files||[]).map((f:AttendanceFile)=><tr key={f.id}><td>{f.originalName}</td><td>{f.status}</td><td>{f.employeeCode||'—'}</td><td>{f.errorMessage||'—'}</td><td>{run.status!=='FINALIZED'&&<ConfirmButton title={L('run.deleteFile.title')} message={L('run.deleteFile.message')} onConfirm={()=>action('delete file',()=>api.deleteRunFile(id!,f.id))}>{L('btn.delete')}</ConfirmButton>}</td></tr>)}
      </tbody></table>
    </section>

    <section className="panel">
      <div className="panel-head"><h3>Employee View</h3><span className="muted">Select one employee to reduce the run screen clutter.</span></div>
      <div className="employee-switcher">
        <button className={!selectedEmployeeId?'active':''} onClick={()=>{setSelectedEmployeeId('');setSelectedPayrollEmployees(payrollAllIds);setShowSelectedPayroll(false);setAttPage(1);setRevPage(1);setPayPage(1)}}>{L('run.btn.allEmployees')}</button>
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
        <DateInput ariaLabel="From date" placeholder="From dd/mmm/yyyy" defaultView={`${run.year}-${String(run.month).padStart(2,'0')}-01`} value={attFilter.dateFrom} onChange={v=>{setAttPage(1);setAttFilter({...attFilter,dateFrom:v})}}/>
        <DateInput ariaLabel="To date" placeholder="To dd/mmm/yyyy" defaultView={attFilter.dateFrom||`${run.year}-${String(run.month).padStart(2,'0')}-01`} value={attFilter.dateTo} onChange={v=>{setAttPage(1);setAttFilter({...attFilter,dateTo:v})}}/>
        <button onClick={()=>setAttFilter({search:'',status:'',late:'',leave:'',holiday:'',weekOff:'',manualReview:'',dateFrom:'',dateTo:''})}>{L('btn.clear')}</button>
        <button onClick={()=>void addManual()}>{L('run.btn.addManual')}</button>
      </div>
      {/* V1.9: Zoho columns (green in the Zoho file) + notes, in an Excel-style grid */}
      {attendance===undefined?<LoadingBlock/>:attendance?.data.length?<div className="xl-wrap"><table className="xl-grid"><thead><tr><th className="xl-rn">#</th><th>Date</th><th>Employee</th><th>Check-in</th><th>Check-out</th><th>Total Hours</th><th>Status</th><th>Check-in Notes</th><th>Check-out Notes</th><th>Late</th><th>Leave</th>{run.status!=='FINALIZED'&&<th>Actions</th>}</tr></thead><tbody>
        {attendance.data.map((a,i)=><tr key={a.id} className={a.isWeekOff?'xl-weekend':a.isHoliday?'xl-holiday':a.status==='MANUAL_REVIEW'?'xl-review':Number(a.leaveFraction||0)>=1?'xl-leave':Number(a.leaveFraction||0)>0?'xl-half':''}>
          <td className="xl-rn">{(attendance.pagination.page-1)*attendance.pagination.pageSize+i+1}</td>
          <td className="nowrap">{fmtDate(a.workDate)}</td>
          <td className="nowrap" title={a.employee.employeeCode}>{a.employee.name}</td>
          <td className="nowrap">{formatTime(a.firstCheckIn)}</td>
          <td className="nowrap">{formatTime(a.lastCheckOut)}</td>
          <td className="num">{fmtHours(a.workedHours)}</td>
          <td className="xl-status" title={`System status: ${a.status}`}>{a.sourceStatus||a.status}</td>
          <td className="xl-note" title={a.checkInNotes||''}>{a.checkInNotes||''}</td>
          <td className="xl-note" title={a.checkOutNotes||''}>{a.checkOutNotes||''}</td>
          <td className={a.isLate?'xl-late':''}>{a.isLate?`Yes${a.lateMinutes?` (${a.lateMinutes}m)`:''}`:''}</td>
          <td className="num">{a.leaveFraction?Number(a.leaveFraction):''}</td>
          {run.status!=='FINALIZED'&&<td className="nowrap"><button className="btn-xs" onClick={()=>void editAttendance(a)}>{L('btn.edit')}</button> <ConfirmButton small title={L('run.deleteAtt.title')} onConfirm={()=>action('delete attendance',()=>api.deleteAttendance(id!,a.id))}>{L('btn.delete')}</ConfirmButton></td>}
        </tr>)}
      </tbody></table></div>:<div className="empty">No attendance records found.</div>}
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
      {reviews===undefined?<LoadingBlock/>:reviews?.data.length?<table><thead><tr><th>Status</th><th>Employee</th><th>Type</th><th>Description</th><th>Penalty</th><th>Double</th><th>Action</th></tr></thead><tbody>{reviews.data.map(r=><tr key={r.id}><td>{r.status}</td><td>{r.employee?.name||'—'}</td><td>{r.type}</td><td>{fmtText(r.description)}</td><td>{r.penaltyAmount??0}</td><td>{r.doubleDeductionLeave?'Yes':'No'}</td><td>{r.status==='OPEN'&&<button onClick={async()=>{const payload=await askReviewResolution(r);if(!payload)return;await action('resolve review',()=>api.resolveReview(r.id,payload))}} >{L('rev.btn.resolve')}</button>} {r.status!=='RESOLVED'&&<ConfirmButton title={L('rev.delete.title')} onConfirm={()=>action('delete review',()=>api.deleteReview(r.id))}>{L('btn.delete')}</ConfirmButton>}</td></tr>)}</tbody></table>:<div className="empty">No reviews match.</div>}
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
          <button onClick={()=>setSelectedPayrollEmployees(employeeSummaries.map((e:any)=>e.employeeId))}>{L('run.btn.selectAll')}</button>
          <button onClick={()=>setSelectedPayrollEmployees([])}>{L('btn.clear')}</button>
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
      <p className="muted">Formula: Total Deduction Leave = max(0, Leave Taken + Late-Mark Leave − Paid Leave) + Double-Deduction Leave. Per-day salary = Gross Salary ÷ actual calendar days in the month. Half-day leave = 0.5 × daily salary. P.Tax = ₹200 when Gross Salary &gt; ₹12,000.</p>
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
        <button onClick={()=>setPayFilter({search:'',hasLate:'',hasLeave:'',hasPenalty:'',hasPtax:'',hasSecurityDeposit:'',minGross:'',maxGross:'',minPayable:'',maxPayable:''})}>{L('btn.clear')}</button>
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
            <td><strong>{r.employee.name}</strong><small>{r.employee.employeeCode}{r.manuallyEdited?' · edited':''}</small></td>
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
              <button onClick={async()=>{const choice=await dialog.choice({title:L('run.deposit.title'),message:L('run.deposit.message',{name:r.employee?.name}),choices:[{label:L('run.deposit.full'),value:'FULL'},{label:L('run.deposit.emi'),value:'EMI_3_MONTHS'}]});if(!choice)return;await action('deposit',()=>api.setDepositMethod(id!,r.employeeId,choice))}}>{L('run.btn.deposit')}</button>{' '}
              <button className="btn-secondary" onClick={async()=>{if(await dialog.confirm({title:L('run.undoDeposit.title',{name:r.employee?.name}),confirmLabel:L('run.btn.undoDeposit')})) void action('reset deposit',()=>api.resetDepositMethod(id!,r.employeeId))}}>{L('run.btn.undoDeposit')}</button>
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
              <label>Join Date<DateInput value={d.joinDate} onChange={v=>setD('joinDate',v)}/></label>
              <label>Renewal Date<DateInput value={d.renewalDate} onChange={v=>setD('renewalDate',v)}/></label>
              <label>Deposit<input type="number" step="0.01" value={d.deposit} onChange={e=>setD('deposit',e.target.value)}/></label>
              <label>Other Deduction<input type="number" step="0.01" value={d.otherDeductions} onChange={e=>setD('otherDeductions',e.target.value)}/></label>
              <label className="wide">Details<input value={d.details} onChange={e=>setD('details',e.target.value)}/></label>
              <div className="editor-actions">
                <button onClick={async () => {
                  // V1.7: send only the values the user changed. Unchanged values stay
                  // calculated; the payable recalculates unless it was edited itself.
                  const initial=payrollDraft({...r,__fresh:true});
                  const map:[string,string][]=[['monthlyPayment','grossSalary'],['perDay','dailySalary'],['leave','leaveDeductionAmount'],['penalty','penalty'],['ptax','ptax'],['payableAmount','payableAmount'],['deductionLeave','deductionLeave'],['halfDay','halfDayCount'],['lateMark','lateMarks'],['paidLeave','paidLeaveAllowance'],['doubleDeductionLeave','doubleDeductionLeave'],['totalLeave','totalLeave'],['workingDays','workingDays'],['deposit','heldSecurityDeposit'],['securityDeposit','securityDeposit'],['otherDeductions','otherDeductions'],['joinDate','joinDate'],['renewalDate','renewalDate'],['details','details']];
                  const payload:any={};
                  for(const [draftKey,apiKey] of map){ if(String(d[draftKey]??'')!==String(initial[draftKey]??'')) payload[apiKey]=d[draftKey]===''?null:d[draftKey]; }
                  if(!Object.keys(payload).length){setPayrollEditId(null);return;}
                  await action('edit payroll', () => api.updatePayrollResult(id!, r.employeeId, payload));
                  setPayrollDrafts(prev=>{const next={...prev};delete next[r.id];return next;});
                  setPayrollEditId(null);
                }}>{L('run.btn.saveChanges')}</button>
                <button onClick={async () => {
                  if(!(await dialog.confirm({title:L('run.clearEdits.title'),message:L('run.clearEdits.message'),confirmLabel:L('run.btn.clearEdits')})))return;
                  await action('reset payroll edits', () => api.updatePayrollResult(id!, r.employeeId, { resetOverrides: true }));
                  setPayrollDrafts(prev=>{const next={...prev};delete next[r.id];return next;});
                  setPayrollEditId(null);
                }}>{L('run.btn.clearEdits')}</button>
                <button className="btn-secondary" onClick={() => setPayrollEditId(null)}>{L('btn.cancel')}</button>
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
  {L('run.btn.export')}
</button>
      {run.status==='FINALIZED'?<button onClick={()=>confirmThen(L('run.reopen.title'),L('run.reopen.message'),'reopen',()=>api.reopenRun(id!))}>{L('run.btn.reopen')}</button>:<button onClick={()=>confirmThen(L('run.finalize.title'),L('run.finalize.message'),'finalize',()=>api.finalizeRun(id!))}>{L('run.btn.finalize')}</button>}</div></section>
  </div>
}
function Reviews(){const[runs,setRuns]=useState<Page<Run>>();const[runId,setRunId]=useState('');const[page,setPage]=useState(1);const[pageSize,setPageSize]=useState(25);const[reviews,setReviews]=useState<Page<Review>>();const[filters,setFilters]=useState({status:'OPEN',type:'',search:'',penaltyPresent:'',doubleDeductionLeave:''});useEffect(()=>{api.runs({page:1,pageSize:100}).then(r=>{setRuns(r);if(!runId&&r.data[0])setRunId(r.data[0].id)}).catch(()=>{})},[]);useEffect(()=>{if(runId)api.reviews(runId,{...filters,page,pageSize}).then(setReviews).catch(()=>{})},[runId,page,pageSize,JSON.stringify(filters)]);return <div><div className="page-head"><div><h1>Manual Review</h1><p>Review exceptions across a selected run.</p></div></div><div className="panel"><div className="filters"><select value={runId} onChange={e=>{setRunId(e.target.value);setPage(1)}}>{runs?.data.map(r=><option key={r.id} value={r.id}>{monthName(r.month)} {r.year}</option>)}</select><select value={filters.status} onChange={e=>setFilters({...filters,status:e.target.value})}><option value="">All</option><option value="OPEN">Open</option><option value="RESOLVED">Resolved</option><option value="REJECTED">Rejected</option></select><select value={filters.type} onChange={e=>setFilters({...filters,type:e.target.value})}><option value="">All Types</option>{['MISSING_CHECKIN','MISSING_CHECKOUT','AMBIGUOUS_LEAVE','EMPLOYEE_MISMATCH','UNEXPECTED_DURATION','OTHER'].map(x=><option key={x}>{x}</option>)}</select><input placeholder="Search employee" value={filters.search} onChange={e=>setFilters({...filters,search:e.target.value})}/><PageSize value={pageSize} onChange={v=>{setPageSize(v);setPage(1)}}/></div>{reviews===undefined&&(!runs||runs.data.length>0)?<LoadingBlock/>:reviews?.data.length?<table><thead><tr><th>Status</th><th>Employee</th><th>Type</th><th>Description</th><th>Action</th></tr></thead><tbody>{reviews.data.map(r=><tr key={r.id}><td>{r.status}</td><td>{r.employee?.name||'—'}</td><td>{r.type}</td><td>{fmtText(r.description)}</td><td>{r.status==='OPEN'&&<button onClick={async()=>{const payload=await askReviewResolution(r);if(!payload)return;try{await api.resolveReview(r.id,payload);setReviews(await api.reviews(runId,{...filters,page,pageSize}));await dialog.success(L('rev.resolved'))}catch(e){await dialog.error(errMessage(e))}}}>{L('rev.btn.resolve')}</button>} {r.status!=='RESOLVED'&&<button className="btn-secondary" onClick={async()=>{if(!(await dialog.confirm({tone:'danger',title:L('rev.delete.title'),confirmLabel:L('btn.delete')})))return;try{await api.deleteReview(r.id);setReviews(await api.reviews(runId,{...filters,page,pageSize}))}catch(e){await dialog.error(errMessage(e))}}}>{L('btn.delete')}</button>}</td></tr>)}</tbody></table>:<div className="empty">No reviews.</div>}<PaginationControls pagination={reviews?.pagination} onChange={setPage}/></div></div>}
function Settings({user,onLabelsChanged}:{user:User;onLabelsChanged:()=>void}){const[rules,setRules]=useState<any[]>([]);const[search,setSearch]=useState('');const[tab,setTab]=useState<'rules'|'labels'>('rules');useEffect(()=>{api.rules().then(setRules).catch(e=>dialog.error(errMessage(e)))},[]);
  return <div><div className="page-head"><div><h1>Settings</h1><p>Business rules and the texts used on buttons and popups.</p></div></div>
  <div className="tabs page-tabs"><button className={tab==='rules'?'on':''} onClick={()=>setTab('rules')}>Rules</button><button className={tab==='labels'?'on':''} onClick={()=>setTab('labels')}>Labels &amp; popup texts</button></div>
  {tab==='rules'?<div className="panel"><div className="filters"><input placeholder="Search rule" value={search} onChange={e=>setSearch(e.target.value)}/></div><table><thead><tr><th>Rule</th><th>Value</th><th>Effective</th><th></th></tr></thead><tbody>{rules.filter(r=>String(r.key).toLowerCase().includes(search.toLowerCase())||String(r.value).toLowerCase().includes(search.toLowerCase())).map(r=><RuleRow key={r.key} rule={r}/>)}</tbody></table></div>
  :<LabelsEditor canEdit={user.role==='CEO'} onChanged={onLabelsChanged}/>}</div>}
function RuleRow({rule}:{rule:any}){const[value,setValue]=useState(String(rule.value));return <tr><td>{rule.key}</td><td><input value={value} onChange={e=>setValue(e.target.value)}/></td><td>{fmtDate(rule.effectiveFrom)}</td><td><button onClick={async()=>{try{await api.updateRule(rule.key,value);await dialog.success(L('set.saved'))}catch(e){await dialog.error(errMessage(e))}}}>{L('set.btn.saveRule')}</button></td></tr>}

// V1.9: the CEO changes any button label or popup text here (saved in the database, no deploy)
function LabelsEditor({canEdit,onChanged}:{canEdit:boolean;onChanged:()=>void}){
  const[search,setSearch]=useState('');const[group,setGroup]=useState('');const[drafts,setDrafts]=useState<Record<string,string>>({});const[,force]=useState(0);
  const groups=Array.from(new Set(Object.values(DEFAULT_LABELS).map(d=>d.group)));
  const over=labelOverrides();
  const q=search.trim().toLowerCase();
  const keys=Object.keys(DEFAULT_LABELS).filter(k=>(!group||DEFAULT_LABELS[k].group===group)&&(!q||k.toLowerCase().includes(q)||L(k).toLowerCase().includes(q)||DEFAULT_LABELS[k].text.toLowerCase().includes(q)));
  const refresh=async()=>{setLabelOverrides(await api.labels());onChanged();force(x=>x+1)};
  const save=async(k:string)=>{try{await api.setLabel(k,drafts[k]);setDrafts(d=>{const n={...d};delete n[k];return n});await refresh();await dialog.success(L('set.saved'))}catch(e){await dialog.error(errMessage(e))}};
  const reset=async(k:string)=>{try{await api.resetLabel(k);setDrafts(d=>{const n={...d};delete n[k];return n});await refresh()}catch(e){await dialog.error(errMessage(e))}};
  return <div className="panel">
    {!canEdit&&<div className="notice">Only the CEO can change labels.</div>}
    <p className="muted">Words in curly brackets, like {'{name}'}, are filled in by the app. Keep them in your text.</p>
    <div className="filters"><input placeholder="Search text or key" value={search} onChange={e=>setSearch(e.target.value)}/><select value={group} onChange={e=>setGroup(e.target.value)}><option value="">All screens</option>{groups.map(g=><option key={g}>{g}</option>)}</select></div>
    <div className="table-scroll"><table className="labels-table"><thead><tr><th>Screen</th><th>Default text</th><th>Text shown</th><th></th></tr></thead><tbody>{keys.map(k=>{const changed=over[k]!==undefined;const v=drafts[k]??L(k);return <tr key={k}>
      <td><small>{DEFAULT_LABELS[k].group}</small><br/><code>{k}</code></td><td className="muted">{DEFAULT_LABELS[k].text}</td>
      <td>{DEFAULT_LABELS[k].text.length>60?<textarea disabled={!canEdit} rows={2} value={v} onChange={e=>setDrafts(d=>({...d,[k]:e.target.value}))}/>:<input disabled={!canEdit} value={v} onChange={e=>setDrafts(d=>({...d,[k]:e.target.value}))}/>}{changed&&<span className="badge warn">changed</span>}</td>
      <td className="nowrap">{canEdit&&<><button disabled={drafts[k]===undefined||!drafts[k].trim()} onClick={()=>save(k)}>{L('set.btn.saveLabel')}</button> <button className="btn-secondary" disabled={!changed} onClick={()=>reset(k)}>{L('set.btn.resetLabel')}</button></>}</td></tr>})}</tbody></table></div>
  </div>;
}
function Payroll(){const nav=useNavigate();const[runs,setRuns]=useState<Page<Run>>();const[page,setPage]=useState(1);const[pageSize,setPageSize]=useState(25);const[filters,setFilters]=useState({year:'',month:'',status:'',search:''});useEffect(()=>{api.runs({...filters,page,pageSize}).then(setRuns).catch(()=>{})},[page,pageSize,JSON.stringify(filters)]);return <div><div className="page-head"><div><h1>Payroll</h1><p>Open a run to review payroll and export.</p></div></div><div className="panel"><div className="filters"><input placeholder="Search year" value={filters.search} onChange={e=>setFilters({...filters,search:e.target.value})}/><select value={filters.year} onChange={e=>setFilters({...filters,year:e.target.value})}><option value="">All Years</option>{Array.from({length:7},(_,i)=>String(new Date().getFullYear()-i)).map(y=><option key={y}>{y}</option>)}</select><select value={filters.month} onChange={e=>setFilters({...filters,month:e.target.value})}><option value="">All Months</option>{Array.from({length:12},(_,i)=><option key={i+1} value={i+1}>{monthName(i+1)}</option>)}</select><select value={filters.status} onChange={e=>setFilters({...filters,status:e.target.value})}><option value="">All Statuses</option>{['DRAFT','PROCESSING','REVIEW','FINALIZED','REOPENED'].map(x=><option key={x}>{x}</option>)}</select><PageSize value={pageSize} onChange={v=>{setPageSize(v);setPage(1)}}/></div>{runs===undefined&&<LoadingBlock/>}{runs?.data.map(r=><div className="card" key={r.id}><strong>{monthName(r.month)} {r.year}</strong><span>{r.status}</span><button onClick={()=>nav(`/runs/${r.id}`)}>{L('btn.open')}</button></div>)}<PaginationControls pagination={runs?.pagination} onChange={setPage}/></div></div>}

function App(){
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [, setLabelsVersion] = useState(0);
  // V1.9: load the label texts changed by the CEO (defaults are in ui/labels.ts)
  const loadLabels = () => api.labels().then((m) => { setLabelOverrides(m); setLabelsVersion((v) => v + 1); }).catch(() => {});

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (token) {
      api.me()
        .then(async (u) => { await loadLabels(); setUser(u); setLoading(false); })
        .catch(() => { localStorage.removeItem('accessToken'); setUser(null); setLoading(false); });
    } else {
      setLoading(false);
    }
  }, []);

  if (loading) return <div className="login-wrap"><div className="busy-card"><span className="spinner"/><span>Loading…</span></div></div>;
  if (!user) return <><LoadingBar/><Login onLogin={(u) => { void loadLabels(); setUser(u); }} /><DialogHost /></>;

  return <div className="app"><LoadingBar/><BusyHost/><aside><div className="brand"><div className="brand-logo"><img src={stwiLogo} alt="STWI"/></div><span className="brand-name">Attendance &amp; Payroll</span></div><div className="userbox"><strong>{user.name}</strong><span>{user.role}</span></div>
    <nav><NavLink to="/" end>{L('nav.dashboard')}</NavLink><NavLink to="/employees">{L('nav.employees')}</NavLink><NavLink to="/runs">{L('nav.runs')}</NavLink><NavLink to="/reviews">{L('nav.reviews')}</NavLink><NavLink to="/payroll">{L('nav.payroll')}</NavLink><NavLink to="/settings">{L('nav.settings')}</NavLink></nav>
    <button className="logout" onClick={()=>{localStorage.removeItem('accessToken');setUser(null)}}>{L('nav.logout')}</button></aside>
    <main><Routes>
      <Route path="/" element={<Dashboard user={user}/>}/>
      <Route path="/employees" element={<EmployeesList/>}/>
      <Route path="/employees/new" element={<EmployeeNew/>}/>
      <Route path="/employees/import" element={<ImportPage/>}/>
      <Route path="/employees/:id" element={<EmployeeDetail user={user}/>}/>
      <Route path="/runs" element={<Runs/>}/><Route path="/runs/:id" element={<RunDetail/>}/><Route path="/reviews" element={<Reviews/>}/><Route path="/payroll" element={<Payroll/>}/>
      <Route path="/settings" element={<Settings user={user} onLabelsChanged={()=>setLabelsVersion(v=>v+1)}/>}/>
      <Route path="*" element={<Navigate to="/" replace/>}/>
    </Routes></main>
    <DialogHost />
  </div>}

export default App;
