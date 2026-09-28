import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, Employee, ImportBatch, Page, User } from '../api';
import { dialog, Modal } from '../ui/dialog';
import { L } from '../ui/labels';
import { currency, errMessage, PageSize, PaginationControls } from '../ui/common';
import { DateInput } from '../ui/DateInput';
import { busy as blocking, LoadingBlock } from '../ui/loading';
import { FormSection, useMasters } from './EmployeeForm';
import { checkAll, firstOfNextMonth, isoDay, localToday, NOTES_FIELD, PERSONAL_FIELDS, SALARY_FIELDS, showDate, ZOHO_FIELDS } from './fields';

const statusBadge = (s: string) => <span className={`badge ${s === 'ACTIVE' ? 'ok' : 'muted'}`}>{s === 'ACTIVE' ? 'Active' : 'Inactive'}</span>;

// ============================================================ list
export function EmployeesList() {
  const nav = useNavigate();
  const masters = useMasters();
  const [result, setResult] = useState<Page<Employee> | null>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [openImport, setOpenImport] = useState<ImportBatch | null>(null);
  const empty = { search: '', status: '', departmentId: '', designationId: '', minSalary: '', maxSalary: '' };
  const [filters, setFilters] = useState(empty);
  useEffect(() => { api.employees({ ...filters, page, pageSize }).then(setResult).catch((e) => dialog.error(errMessage(e))); }, [page, pageSize, JSON.stringify(filters)]);
  useEffect(() => { api.currentImport().then(setOpenImport).catch(() => {}); }, []);
  const sf = (k: string, v: string) => { setPage(1); setFilters({ ...filters, [k]: v }); };
  const pending = openImport ? openImport.summary.problems + openImport.summary.needsDetails + openImport.summary.ready + openImport.summary.changed : 0;

  return <div>
    <div className="page-head">
      <div><h1>Employees</h1><p>Add employees by hand or import them from the Zoho People “Employee View” export.</p></div>
      <div className="actions">
        <button className="btn-secondary" onClick={() => nav('/employees/import')}>{L('emp.btn.import')}{pending ? ` · ${pending} pending` : ''}</button>
        <button className="btn-primary" onClick={() => nav('/employees/new')}>{L('emp.btn.add')}</button>
      </div>
    </div>
    {openImport && pending > 0 && <div className="notice">An import from <b>{openImport.fileName}</b> is not finished: {pending} employee(s) still need attention. <a href="/employees/import" onClick={(e) => { e.preventDefault(); nav('/employees/import'); }}>Continue import →</a></div>}
    <div className="panel">
      <div className="panel-head"><h3>Employee List</h3><PageSize value={pageSize} onChange={(v) => { setPageSize(v); setPage(1); }} /></div>
      <div className="filters">
        <input placeholder="Search ID / name / email" value={filters.search} onChange={(e) => sf('search', e.target.value)} />
        <select value={filters.status} onChange={(e) => sf('status', e.target.value)}><option value="">All Statuses</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select>
        <select value={filters.departmentId} onChange={(e) => sf('departmentId', e.target.value)}><option value="">All Departments</option>{masters.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        <select value={filters.designationId} onChange={(e) => sf('designationId', e.target.value)}><option value="">All Designations</option>{masters.designations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        <input placeholder="Min salary" type="number" value={filters.minSalary} onChange={(e) => sf('minSalary', e.target.value)} />
        <input placeholder="Max salary" type="number" value={filters.maxSalary} onChange={(e) => sf('maxSalary', e.target.value)} />
        <button className="btn-secondary" onClick={() => { setFilters(empty); setPage(1); }}>{L('btn.clear')}</button>
      </div>
      {result === undefined ? <LoadingBlock /> : result?.data.length ? <div className="table-scroll"><table><thead><tr><th>ID</th><th>Name</th><th>Department</th><th>Designation</th><th>Type</th><th>Joined</th><th>Salary</th><th>Status</th><th></th></tr></thead><tbody>
        {result.data.map((e) => <tr key={e.id} className="clickable" onClick={() => nav(`/employees/${e.id}`)}>
          <td>{e.employeeCode}</td><td><b>{e.name}</b><br /><small>{e.email || ''}</small></td><td>{e.department?.name || '—'}</td><td>{e.designation?.name || '—'}</td><td>{e.employmentType || '—'}</td>
          <td>{showDate(e.joiningDate)}</td><td>{currency(e.salaryHistory[0]?.grossSalary)}</td><td>{statusBadge(e.status)}{e.dateOfExit ? <small> exit {showDate(e.dateOfExit)}</small> : null}</td>
          <td><button onClick={(ev) => { ev.stopPropagation(); nav(`/employees/${e.id}`); }}>{L('btn.open')}</button></td>
        </tr>)}
      </tbody></table></div> : <div className="empty">No employees found.</div>}
      <PaginationControls pagination={result?.pagination} onChange={setPage} />
    </div>
  </div>;
}

// ============================================================ add (manual entry)
export function EmployeeNew() {
  const nav = useNavigate();
  const masters = useMasters();
  const [values, setValues] = useState<Record<string, any>>({ professionalTaxApplicable: true, securityDepositAlreadyTaken: '0' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const all = [...ZOHO_FIELDS, ...PERSONAL_FIELDS, ...SALARY_FIELDS, NOTES_FIELD];
  const set = (k: string, v: any) => {
    setErrors((e) => { const n = { ...e }; delete n[k]; return n; });
    setValues((s) => ({ ...s, [k]: v, ...(k === 'joiningDate' && (!s.salaryEffectiveFrom || s.salaryEffectiveFrom === s.joiningDate) ? { salaryEffectiveFrom: v } : {}) }));
  };
  const submit = async () => {
    const errs = checkAll(all, values);
    if (Number(values.securityDepositAlreadyTaken) > Number(values.grossSalary)) errs.securityDepositAlreadyTaken = 'Cannot be more than the gross salary.';
    setErrors(errs);
    if (Object.keys(errs).length) { await dialog.error(`Please fix ${Object.keys(errs).length} field(s) marked in red.`, 'Some details are missing'); return; }
    setBusy(true);
    try {
      const emp = await blocking.run('Creating the employee…', () => api.createEmployee(values));
      await dialog.success(L('emp.created', { name: emp.name, code: emp.employeeCode }));
      nav(`/employees/${emp.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.fieldErrors) setErrors(e.fieldErrors);
      await dialog.error(errMessage(e));
    } finally { setBusy(false); }
  };
  return <div>
    <div className="page-head"><div><button className="btn-secondary" onClick={() => nav('/employees')}>{L('btn.back')}</button><h1>Add Employee</h1><p>Every field marked * is required. Use the same values as in Zoho People.</p></div></div>
    <div className="panel form-panel">
      <FormSection title="Zoho details" subtitle="Yellow columns of the Zoho Employee View" tone="zoho" fields={ZOHO_FIELDS} values={values} errors={errors} onChange={set} masters={masters} />
      <FormSection title="Personal details" subtitle="Green columns" tone="manual" fields={PERSONAL_FIELDS} values={values} errors={errors} onChange={set} masters={masters} />
      <FormSection title="Salary & security deposit" fields={SALARY_FIELDS} values={values} errors={errors} onChange={set} masters={masters} />
      <FormSection title="Other" fields={[NOTES_FIELD]} values={values} errors={errors} onChange={set} masters={masters} />
      <div className="form-actions"><button className="btn-secondary" onClick={() => nav('/employees')}>{L('btn.cancel')}</button><button className="btn-primary" disabled={busy} onClick={submit}>{L('emp.btn.create')}</button></div>
    </div>
  </div>;
}

// ============================================================ detail
const EDIT_FIELDS = [...ZOHO_FIELDS.filter((f) => f.key !== 'employeeCode'), ...PERSONAL_FIELDS, SALARY_FIELDS.find((f) => f.key === 'professionalTaxApplicable')!, NOTES_FIELD];

function toForm(e: Employee) {
  const v: Record<string, any> = {};
  for (const f of EDIT_FIELDS) v[f.key] = (e as any)[f.key] ?? '';
  v.department = e.department?.name ?? '';
  v.designation = e.designation?.name ?? '';
  v.joiningDate = isoDay(e.joiningDate);
  v.dateOfBirth = isoDay(e.dateOfBirth);
  v.professionalTaxApplicable = e.professionalTaxApplicable !== false;
  return v;
}

export function EmployeeDetail({ user }: { user: User }) {
  const { id } = useParams();
  const nav = useNavigate();
  const masters = useMasters();
  const [emp, setEmp] = useState<Employee | null>();
  const [values, setValues] = useState<Record<string, any>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [salary, setSalary] = useState({ grossSalary: '', effectiveFrom: firstOfNextMonth(), notes: '' });
  const [danger, setDanger] = useState(false);
  const canEdit = user.role === 'CEO' || user.role === 'HR';

  const load = async () => { if (!id) return; try { const e = await api.employee(id); setEmp(e); setValues(toForm(e)); } catch (err) { await dialog.error(errMessage(err)); nav('/employees'); } };
  useEffect(() => { void load(); }, [id]);

  const current = Number(emp?.salaryHistory[0]?.grossSalary || 0);
  const held = Number(emp?.depositHeld || 0);
  const shortfall = Math.max(0, current - held);
  const monthDays = useMemo(() => new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate(), []);
  if (!emp) return <div className="panel">Loading…</div>;
  const missing = EDIT_FIELDS.filter((f) => f.required && f.kind !== 'bool' && checkAll([f], toForm(emp))[f.key]);

  const set = (k: string, v: any) => { setErrors((e) => { const n = { ...e }; delete n[k]; return n; }); setValues((s) => ({ ...s, [k]: v })); };
  const saveInfo = async () => {
    // only the fields that were changed are checked and sent, so an older
    // employee with empty fields can still be corrected step by step
    const before = toForm(emp);
    const changed = EDIT_FIELDS.filter((f) => String(values[f.key] ?? '') !== String(before[f.key] ?? ''));
    if (!changed.length) { setEditing(false); return; }
    const errs = checkAll(changed, values);
    setErrors(errs);
    if (Object.keys(errs).length) { await dialog.error(`Please fix ${Object.keys(errs).length} field(s) marked in red.`); return; }
    const payload = Object.fromEntries(changed.map((f) => [f.key, values[f.key]]));
    try { const e = await api.updateEmployee(emp.id, payload); setEmp({ ...e, depositHeld: emp.depositHeld }); setValues(toForm(e)); setEditing(false); await dialog.success(L('emp.saved')); }
    catch (e) { if (e instanceof ApiError && e.fieldErrors) setErrors(e.fieldErrors); await dialog.error(errMessage(e)); }
  };
  const addSalary = async () => {
    if (!salary.grossSalary || Number(salary.grossSalary) < 0) { await dialog.error('Enter the new gross salary.'); return; }
    try { const e = await api.addSalary(emp.id, salary); setEmp(e); setSalary({ grossSalary: '', effectiveFrom: firstOfNextMonth(), notes: '' }); await dialog.success(L('emp.salarySaved')); }
    catch (e) { await dialog.error(errMessage(e)); }
  };
  const editSalaryRow = async (s: any) => {
    const v = await dialog.form({ title: 'Edit salary row', fields: [
      { name: 'grossSalary', label: 'Gross Salary (₹)', type: 'number', min: 0, required: true, default: String(Number(s.grossSalary)) },
      { name: 'effectiveFrom', label: 'Effective From', type: 'date', required: true, default: isoDay(s.effectiveFrom) },
      { name: 'notes', label: 'Reason / note', type: 'text', default: s.notes || '' },
    ] });
    if (!v) return;
    try { setEmp(await api.updateSalary(emp.id, s.id, v)); await dialog.success(L('emp.salarySaved')); } catch (e) { await dialog.error(errMessage(e)); }
  };
  const deleteSalaryRow = async (s: any) => {
    if (!(await dialog.confirm({ tone: 'danger', title: L('emp.salaryRowDelete.title'), message: `${currency(s.grossSalary)} from ${showDate(s.effectiveFrom)}. Payroll months already calculated keep their amounts; months calculated again will use the remaining rows.`, confirmLabel: L('btn.delete') }))) return;
    try { setEmp(await api.deleteSalary(emp.id, s.id)); await dialog.success(L('emp.salaryRowDeleted')); } catch (e) { await dialog.error(errMessage(e)); }
  };
  const deactivate = async () => {
    const v = await dialog.form({ tone: 'warning', title: L('emp.deactivate.title', { name: emp.name }), message: L('emp.deactivate.message'), submitLabel: L('emp.btn.deactivate'),
      fields: [{ name: 'dateOfExit', label: 'Date of Exit (last working day)', type: 'date', required: true, default: localToday() }] });
    if (!v) return;
    try { setEmp(await api.deactivateEmployee(emp.id, v.dateOfExit)); await dialog.success(L('emp.deactivated', { name: emp.name })); } catch (e) { await dialog.error(errMessage(e)); }
  };
  const reactivate = async () => {
    if (!(await dialog.confirm({ tone: 'info', title: L('emp.reactivate.title', { name: emp.name }), message: L('emp.reactivate.message'), confirmLabel: L('emp.btn.reactivate') }))) return;
    try { setEmp(await api.reactivateEmployee(emp.id)); await dialog.success(L('emp.reactivated', { name: emp.name })); } catch (e) { await dialog.error(errMessage(e)); }
  };

  return <div>
    <div className="page-head">
      <div>
        <button className="btn-secondary" onClick={() => nav('/employees')}>{L('btn.back')}</button>
        <h1>{emp.name} {statusBadge(emp.status)}</h1>
        <p>Employee ID <b>{emp.employeeCode}</b> · {emp.department?.name || 'No department'} · {emp.designation?.name || 'No designation'}{emp.dateOfExit ? <> · Exit {showDate(emp.dateOfExit)}</> : null}</p>
      </div>
      {canEdit && <div className="actions">
        {emp.status === 'ACTIVE' ? <button className="btn-secondary" onClick={deactivate}>{L('emp.btn.deactivate')}</button> : <button className="btn-primary" onClick={reactivate}>{L('emp.btn.reactivate')}</button>}
        {emp.status === 'INACTIVE' && user.role === 'CEO' && <button className="btn-danger" onClick={() => setDanger(true)}>{L('emp.btn.deleteEmployee')}</button>}
      </div>}
    </div>
    <div className="stats-grid">
      <div className="metric"><span>Current Salary</span><strong>{currency(current)}</strong><small>from {showDate(emp.salaryHistory[0]?.effectiveFrom)}</small></div>
      <div className="metric"><span>Deposit Held</span><strong>{currency(held)}</strong></div>
      <div className="metric"><span>Deposit Still Due</span><strong>{currency(shortfall)}</strong><small>target = current salary</small></div>
      <div className="metric"><span>Daily Salary</span><strong>{currency(current / monthDays)}</strong><small>this month ({monthDays} days)</small></div>
    </div>
    {missing.length > 0 && <div className="notice warn">Profile incomplete: {missing.map((f) => f.label).join(', ')} {missing.length === 1 ? 'is' : 'are'} empty. Click Edit to fill {missing.length === 1 ? 'it' : 'them'}.</div>}
    <div className="panel form-panel">
      <div className="panel-head"><h3>Employee Information</h3>{canEdit && (editing
        ? <div className="actions"><button className="btn-secondary" onClick={() => { setEditing(false); setValues(toForm(emp)); setErrors({}); }}>{L('btn.cancel')}</button><button className="btn-primary" onClick={saveInfo}>{L('emp.btn.saveInfo')}</button></div>
        : <button onClick={() => setEditing(true)}>{L('btn.edit')}</button>)}</div>
      <FormSection title="Zoho details" tone="zoho" fields={ZOHO_FIELDS} values={{ ...values, employeeCode: emp.employeeCode }} errors={errors} onChange={set} masters={masters} readOnly={!editing} readOnlyKeys={['employeeCode']} />
      <FormSection title="Personal details" tone="manual" fields={PERSONAL_FIELDS} values={values} errors={errors} onChange={set} masters={masters} readOnly={!editing} />
      <FormSection title="Payroll" fields={[SALARY_FIELDS.find((f) => f.key === 'professionalTaxApplicable')!]} values={values} errors={errors} onChange={set} masters={masters} readOnly={!editing} />
      <FormSection title="Other" fields={[NOTES_FIELD]} values={values} errors={errors} onChange={set} masters={masters} readOnly={!editing} />
    </div>
    <div className="detail-grid" style={{ marginTop: 18 }}>
      <section className="panel">
        <h3>Salary Increase</h3>
        <p className="muted">Adds a new salary row. Any extra security deposit is collected in that month's payroll (Full or EMI).</p>
        <div className="form-grid two">
          <label>New Gross Salary (₹)<input type="number" min="0" value={salary.grossSalary} onChange={(e) => setSalary({ ...salary, grossSalary: e.target.value })} /></label>
          <label>Effective From<DateInput value={salary.effectiveFrom} onChange={(v) => setSalary({ ...salary, effectiveFrom: v })} /></label>
          <label className="wide">Reason / note<input value={salary.notes} placeholder="e.g. Annual increment" onChange={(e) => setSalary({ ...salary, notes: e.target.value })} /></label>
        </div>
        {canEdit && <div className="form-actions"><button className="btn-primary" onClick={addSalary}>{L('emp.btn.saveSalary')}</button></div>}
      </section>
      <section className="panel">
        <h3>Salary History</h3>
        <table><thead><tr><th>Effective From</th><th>Gross</th><th>Note</th>{canEdit && <th></th>}</tr></thead><tbody>
          {emp.salaryHistory.map((s) => <tr key={s.id}><td>{showDate(s.effectiveFrom)}</td><td>{currency(s.grossSalary)}</td><td>{s.notes || '—'}</td>
            {canEdit && <td className="nowrap"><button className="btn-secondary" onClick={() => editSalaryRow(s)}>{L('emp.btn.editSalaryRow')}</button> <button className="btn-secondary" disabled={emp.salaryHistory.length <= 1} title={emp.salaryHistory.length <= 1 ? 'The only salary row cannot be deleted' : ''} onClick={() => deleteSalaryRow(s)}>{L('emp.btn.deleteSalaryRow')}</button></td>}</tr>)}
        </tbody></table>
      </section>
    </div>
    {danger && <DangerZone emp={emp} onClose={() => setDanger(false)} onDeleted={() => nav('/employees')} />}
  </div>;
}

// ============================================================ danger zone
function DangerZone({ emp, onClose, onDeleted }: { emp: Employee; onClose: () => void; onDeleted: () => void }) {
  const [exported, setExported] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const doExport = async () => { try { setBusy(true); setExported(await blocking.run('Preparing the employee file…', () => api.exportEmployee(emp.id))); } catch (e) { await dialog.error(errMessage(e)); } finally { setBusy(false); } };
  const doDelete = async () => {
    try {
      setBusy(true);
      await blocking.run('Deleting the employee…', () => api.deleteEmployee(emp.id, typed.trim()));
      onClose();
      await dialog.success(L('emp.deleted', { name: emp.name }));
      onDeleted();
    } catch (e) { await dialog.error(errMessage(e)); } finally { setBusy(false); }
  };
  const canDelete = !!exported && typed.trim() === emp.employeeCode && !busy;
  return <Modal tone="danger" title={L('emp.danger.title', { name: emp.name })} onClose={onClose}
    footer={<><button className="btn-secondary" onClick={onClose}>{L('btn.cancel')}</button><button className="btn-danger" disabled={!canDelete} onClick={doDelete}>{L('emp.btn.deleteEmployee')}</button></>}>
    <div className="modal-message">{L('emp.danger.message')}</div>
    {Number(emp.depositHeld || 0) > 0 && <div className="notice warn">Security deposit still held: <b>{currency(emp.depositHeld)}</b>. Settle it before deleting (refunds come in a later release).</div>}
    <div className={`danger-step${exported ? ' done' : ''}`}>
      <b>Step 1.</b> Download the employee's information (profile, salary, deposit, payroll, attendance).
      <div><button className="btn-primary" disabled={busy} onClick={doExport}>{L('emp.btn.export')}</button> {exported && <span className="badge ok">✓ Downloaded {exported}</span>}</div>
    </div>
    <div className={`danger-step${exported ? '' : ' locked'}`}>
      <b>Step 2.</b> {L('emp.danger.typeToConfirm', { code: emp.employeeCode })}
      <input disabled={!exported} value={typed} autoComplete="off" onChange={(e) => setTyped(e.target.value)} placeholder={emp.employeeCode} />
    </div>
  </Modal>;
}
