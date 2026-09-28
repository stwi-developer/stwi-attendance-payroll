import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ImportBatch, ImportRow } from '../api';
import { dialog } from '../ui/dialog';
import { L } from '../ui/labels';
import { errMessage } from '../ui/common';
import { fmtDateTime } from '../ui/date';
import { busy as blocking } from '../ui/loading';
import { FormSection, useMasters } from './EmployeeForm';
import { checkAll, NOTES_FIELD, PERSONAL_FIELDS, SALARY_FIELDS, showDate, ZOHO_FIELDS } from './fields';

// V1.9: Zoho "Employee View" import. Yellow values come from the file (read-only here);
// green fields and salary are filled per employee; then employees are created.

const STATUS: Record<string, { label: string; cls: string }> = {
  PROBLEM: { label: 'Fix in Zoho', cls: 'bad' },
  NEEDS_DETAILS: { label: 'Needs details', cls: 'warn' },
  READY: { label: 'Ready', cls: 'ok' },
  CREATED: { label: 'Created', cls: 'info' },
  CHANGED: { label: 'Changed in Zoho', cls: 'warn' },
  UNCHANGED: { label: 'Already in app', cls: 'muted' },
  UPDATED: { label: 'Updated', cls: 'info' },
  SKIPPED: { label: 'Skipped', cls: 'muted' },
  NOT_ACTIVE: { label: 'Not active in Zoho', cls: 'muted' },
};
const TABS: { key: string; label: string; match: (r: ImportRow) => boolean }[] = [
  { key: 'todo', label: 'To do', match: (r) => ['PROBLEM', 'NEEDS_DETAILS', 'READY', 'CHANGED'].includes(r.status) },
  { key: 'problems', label: 'Fix in Zoho', match: (r) => r.status === 'PROBLEM' },
  { key: 'needs', label: 'Needs details', match: (r) => r.status === 'NEEDS_DETAILS' },
  { key: 'ready', label: 'Ready', match: (r) => r.status === 'READY' },
  { key: 'existing', label: 'Already in app', match: (r) => r.action === 'EXISTING' },
  { key: 'done', label: 'Done', match: (r) => ['CREATED', 'UPDATED', 'SKIPPED', 'UNCHANGED', 'NOT_ACTIVE'].includes(r.status) },
  { key: 'all', label: 'All', match: () => true },
];
const DETAIL_FIELDS = [...PERSONAL_FIELDS, ...SALARY_FIELDS, NOTES_FIELD];
const nameOf = (r: ImportRow) => `${r.zohoJson.values.firstName ?? ''} ${r.zohoJson.values.lastName ?? ''}`.trim() || r.employeeCode;

export function ImportPage() {
  const nav = useNavigate();
  const masters = useMasters();
  const fileRef = useRef<HTMLInputElement>(null);
  const [batch, setBatch] = useState<ImportBatch | null | undefined>(undefined);
  const [tab, setTab] = useState('todo');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [checked, setChecked] = useState<string[]>([]);
  const [values, setValues] = useState<Record<string, any>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.currentImport().then(setBatch).catch((e) => { setBatch(null); void dialog.error(errMessage(e)); }); }, []);

  const rows = batch?.rows ?? [];
  const visible = useMemo(() => {
    const t = TABS.find((x) => x.key === tab)!;
    const q = search.trim().toLowerCase();
    return rows.filter((r) => t.match(r) && (!q || nameOf(r).toLowerCase().includes(q) || r.employeeCode.toLowerCase().includes(q)));
  }, [rows, tab, search]);
  const selected = rows.find((r) => r.id === selectedId) ?? null;

  // pick the first row to work on when the tab changes (tabs ask before dropping unsaved details)
  useEffect(() => { if (batch && (!selected || !visible.some((r) => r.id === selected.id)) && visible[0] && !dirty) select(visible[0]); }, [batch, tab]);

  function select(r: ImportRow) { setSelectedId(r.id); setValues({ ...(r.manualJson ?? {}) }); setErrors({}); setDirty(false); }

  const confirmLeave = async () => !dirty || dialog.confirm({ title: 'Unsaved details', message: `You typed details for ${selected ? nameOf(selected) : 'this employee'} that are not saved yet. Leave without saving?`, confirmLabel: 'Leave without saving' });
  const choose = async (r: ImportRow) => { if (r.id === selectedId) return; if (await confirmLeave()) select(r); };

  const upload = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      const b = await blocking.run('Reading the Employee View file…', () => api.uploadImport(file));
      setBatch(b); setChecked([]); setTab('todo');
      const s = b.summary;
      await dialog.success(L('imp.uploaded', { total: s.total, file: b.fileName, ready: s.ready, needs: s.needsDetails, problems: s.problems, existing: s.existing }), 'File uploaded');
      const first = b.rows.find((r) => TABS[0].match(r)); if (first) select(first);
    } catch (e) { await dialog.error(errMessage(e)); } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const save = async (goNext: boolean) => {
    if (!batch || !selected) return;
    setBusy(true);
    try {
      const res = await api.saveImportRow(batch.id, selected.id, values);
      setBatch(res.batch); setDirty(false);
      const fieldErrors = { ...checkAll(DETAIL_FIELDS, values), ...res.fieldErrors };
      const updated = res.batch.rows.find((r) => r.id === selected.id)!;
      const order = res.batch.rows.filter((r) => ['NEEDS_DETAILS', 'PROBLEM'].includes(r.status) && r.action === 'NEW');
      const next = order.find((r) => r.rowNumber > updated.rowNumber) ?? order.find((r) => r.id !== updated.id);
      if (goNext && updated.status !== 'NEEDS_DETAILS' && next) { select(next); return; }
      select(updated);
      setErrors(fieldErrors); // after select(), which clears the red marks
      if (updated.status === 'NEEDS_DETAILS') await dialog.alert(`Saved. ${updated.missingCount} field(s) are still missing for ${nameOf(updated)}; they are marked in red.`, { title: 'Saved', tone: 'warning' });
      else if (!goNext || !next) await dialog.success(`${nameOf(updated)} is ready to create.`, 'Saved');
    } catch (e) { await dialog.error(errMessage(e)); } finally { setBusy(false); }
  };

  const create = async (ids?: string[]) => {
    if (!batch) return;
    if (dirty && !(await confirmLeave())) return;
    setBusy(true);
    try {
      const res = await blocking.run('Creating employees…', () => api.createFromImport(batch.id, ids));
      setBatch(res.batch); setChecked([]); setDirty(false);
      const failed = res.failed.length ? `\n\nNot created:\n${res.failed.map((f) => `• ${f.employeeCode}: ${f.message}`).join('\n')}` : '';
      if (res.created.length) await dialog.success(L('imp.created', { count: res.created.length }) + failed);
      else await dialog.error(`No employee was created.${failed}`);
    } catch (e) { await dialog.error(errMessage(e)); } finally { setBusy(false); }
  };

  const decide = async (r: ImportRow, apply: boolean) => {
    if (!batch) return;
    setBusy(true);
    try { const b = apply ? await api.applyImportRow(batch.id, r.id) : await api.skipImportRow(batch.id, r.id); setBatch(b); await dialog.success(apply ? `${nameOf(r)} was updated with the Zoho values.` : `${nameOf(r)} was skipped.`); }
    catch (e) { await dialog.error(errMessage(e)); } finally { setBusy(false); }
  };

  const cancelImport = async () => {
    if (!batch || !(await dialog.confirm({ tone: 'danger', title: L('imp.cancel.title'), message: L('imp.cancel.message'), confirmLabel: L('imp.btn.cancelImport') }))) return;
    try { await api.cancelImport(batch.id); setBatch(null); setSelectedId(''); } catch (e) { await dialog.error(errMessage(e)); }
  };

  const fileInput = <input ref={fileRef} type="file" accept=".xls,.xlsx" hidden onChange={(e) => void upload(e.target.files?.[0])} />;

  if (batch === undefined) return <div className="panel">Loading…</div>;

  if (!batch) return <div>
    <div className="page-head"><div><button className="btn-secondary" onClick={() => nav('/employees')}>{L('btn.back')}</button><h1>Import from Zoho</h1><p>Create employees from the Zoho People “Employee View” export.</p></div></div>
    <div className="panel upload-card">
      <ol className="steps">
        <li>In Zoho People open <b>Employees → Employee View</b> and export it as <b>XLS</b>.</li>
        <li>Upload the file here. The yellow Zoho columns are read from the file.</li>
        <li>For each employee fill the personal details, salary and deposit, then create them.</li>
      </ol>
      {fileInput}
      <button className="btn-primary" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? 'Uploading…' : L('imp.btn.upload')}</button>
    </div>
  </div>;

  const s = batch.summary;
  const newRows = rows.filter((r) => r.action === 'NEW' && r.status !== 'NOT_ACTIVE');
  const doneNew = newRows.filter((r) => r.status === 'CREATED').length;
  const readyRows = rows.filter((r) => r.status === 'READY');
  const readyChecked = checked.filter((id) => readyRows.some((r) => r.id === id));

  return <div className="import-page">
    <div className="page-head">
      <div><button className="btn-secondary" onClick={async () => { if (await confirmLeave()) nav('/employees'); }}>{L('btn.back')}</button><h1>Import from Zoho</h1>
        <p><b>{batch.fileName}</b> · uploaded {fmtDateTime(batch.createdAt)} · {s.total} employees in file</p></div>
      <div className="actions">{fileInput}
        <button className="btn-secondary" disabled={busy} title="Upload the fixed Zoho file. Details already typed are kept." onClick={async () => { if (await confirmLeave()) fileRef.current?.click(); }}>Upload again</button>
        <button className="btn-secondary" onClick={cancelImport}>{L('imp.btn.cancelImport')}</button>
      </div>
    </div>

    <div className="import-summary panel">
      <div className="progress"><div style={{ width: `${newRows.length ? (100 * (doneNew + s.ready)) / newRows.length : 100}%` }} /></div>
      <div className="summary-chips">
        <span><b>{doneNew}</b> of {newRows.length} new employees created</span>
        <span className="badge ok">{s.ready} ready</span><span className="badge warn">{s.needsDetails} need details</span><span className="badge bad">{s.problems} fix in Zoho</span>
        {s.changed > 0 && <span className="badge warn">{s.changed} changed in Zoho</span>}
        <span className="badge muted">{s.unchanged} unchanged</span>
      </div>
      {!!batch.missingJson?.length && <div className="notice warn">Not in this file but active in the app: {batch.missingJson.map((m, i) => <span key={m.id}>{i ? ', ' : ''}<a href={`/employees/${m.id}`} onClick={(e) => { e.preventDefault(); nav(`/employees/${m.id}`); }}>{m.name} ({m.employeeCode})</a></span>)}. Have they left? Open the employee and use Deactivate.</div>}
    </div>

    <div className="import-layout">
      <div className="import-list panel">
        <div className="tabs">{TABS.map((t) => { const n = rows.filter(t.match).length; return <button key={t.key} className={tab === t.key ? 'on' : ''} onClick={async () => { if (t.key !== tab && (await confirmLeave())) { setDirty(false); setTab(t.key); } }}>{t.label} <small>{n}</small></button>; })}</div>
        <input placeholder="Search name or ID" value={search} onChange={(e) => setSearch(e.target.value)} />
        <ul>
          {visible.map((r) => {
            const st = STATUS[r.status] ?? { label: r.status, cls: 'muted' };
            return <li key={r.id} className={r.id === selectedId ? 'on' : ''} onClick={() => void choose(r)}>
              {r.status === 'READY' ? <input type="checkbox" checked={checked.includes(r.id)} onClick={(e) => e.stopPropagation()} onChange={(e) => setChecked((c) => (e.target.checked ? [...c, r.id] : c.filter((x) => x !== r.id)))} /> : <span className="cb-space" />}
              <div className="who"><b>{nameOf(r)}</b><small>{r.employeeCode} · {r.zohoJson.values.department || 'no department'}</small></div>
              <div className="state"><span className={`badge ${st.cls}`}>{st.label}</span>{r.status === 'NEEDS_DETAILS' && <small>{r.missingCount} missing</small>}{r.status === 'PROBLEM' && <small>{r.problemsJson?.length} to fix</small>}</div>
            </li>;
          })}
          {!visible.length && <li className="empty">Nothing here.</li>}
        </ul>
      </div>

      <section className="import-detail panel">
        {!selected ? <div className="empty">Select an employee on the left.</div> : rowDetail(selected)}
      </section>
    </div>

    <div className="import-bar">
      <span>{readyRows.length} ready to create{readyChecked.length ? ` · ${readyChecked.length} selected` : ''}</span>
      <button className="btn-secondary" disabled={busy || !readyChecked.length} onClick={() => create(readyChecked)}>{L('imp.btn.createSelected')}</button>
      <button className="btn-primary" disabled={busy || !readyRows.length} onClick={() => create()}>{L('imp.btn.createReady')} ({readyRows.length})</button>
    </div>
  </div>;

  // called as a plain function (not <RowDetail/>) so inputs keep focus while typing
  function rowDetail(row: ImportRow) {
    const st = STATUS[row.status] ?? { label: row.status, cls: 'muted' };
    const zoho = row.zohoJson.values;
    const head = <div className="panel-head"><div><h3>{nameOf(row)} <span className={`badge ${st.cls}`}>{st.label}</span></h3><small className="muted">Excel row {row.rowNumber} · Employee ID {row.employeeCode}</small></div></div>;

    if (row.action === 'EXISTING') return <div>
      {head}
      {row.status === 'CHANGED' ? <>
        <p>This employee already exists. Zoho has different values:</p>
        <table className="diff"><thead><tr><th>Field</th><th>In the app</th><th>In Zoho</th></tr></thead><tbody>{row.diffJson?.map((d) => <tr key={d.field}><td>{d.label}</td><td>{d.field.endsWith('Date') || d.field === 'dateOfBirth' ? showDate(d.from === '—' ? null : d.from) : d.from}</td><td><b>{d.field.endsWith('Date') || d.field === 'dateOfBirth' ? showDate(d.to) : d.to}</b></td></tr>)}</tbody></table>
        <div className="form-actions"><button className="btn-secondary" disabled={busy} onClick={() => decide(row, false)}>{L('imp.btn.skip')}</button><button className="btn-primary" disabled={busy} onClick={() => decide(row, true)}>{L('imp.btn.applyUpdate')}</button></div>
      </> : row.status === 'PROBLEM' ? <ProblemBox row={row} /> : <p className="muted">{row.status === 'UPDATED' ? 'The Zoho changes were applied.' : row.status === 'SKIPPED' ? 'Skipped: the app keeps its values.' : 'Nothing changed in Zoho for this employee.'}</p>}
      {row.employeeId && <p><a href={`/employees/${row.employeeId}`} onClick={(e) => { e.preventDefault(); nav(`/employees/${row.employeeId}`); }}>Open employee →</a></p>}
    </div>;

    if (row.status === 'NOT_ACTIVE') return <div>{head}<p className="muted">This person is “{row.zohoJson.zohoStatus}” in Zoho and is not in the app, so they are not imported.</p></div>;
    if (row.status === 'CREATED') return <div>{head}<p>Created.</p>{row.employeeId && <button onClick={() => nav(`/employees/${row.employeeId}`)}>Open employee</button>}</div>;

    const setV = (k: string, v: any) => { setDirty(true); setErrors((e) => { const n = { ...e }; delete n[k]; return n; }); setValues((s) => ({ ...s, [k]: v })); };
    return <div>
      {head}
      {row.status === 'PROBLEM' && <ProblemBox row={row} />}
      <FormSection title="From Zoho" subtitle="Read from the file. To change these, edit Zoho and upload again." tone="zoho" fields={ZOHO_FIELDS} values={zoho} masters={masters} readOnly />
      <FormSection title="Personal details" subtitle="Pre-filled where Zoho has them" tone="manual" fields={PERSONAL_FIELDS} values={values} errors={errors} onChange={setV} masters={masters} />
      <FormSection title="Salary & security deposit" fields={SALARY_FIELDS} values={values} errors={errors} onChange={setV} masters={masters} />
      <FormSection title="Other" fields={[NOTES_FIELD]} values={values} errors={errors} onChange={setV} masters={masters} />
      <div className="form-actions sticky">
        {dirty && <span className="muted">Unsaved changes</span>}
        <button className="btn-secondary" disabled={busy} onClick={() => save(false)}>{L('imp.btn.save')}</button>
        <button className="btn-primary" disabled={busy} onClick={() => save(true)}>{L('imp.btn.saveNext')}</button>
      </div>
    </div>;
  }
}

function ProblemBox({ row }: { row: ImportRow }) {
  return <div className="notice bad">
    <b>Fix these in Zoho, export the Employee View again and click “Upload again”.</b> Details you type below are kept.
    <ul>{row.problemsJson?.map((p, i) => <li key={i}>{p.cell && <span className="cell-ref">{p.cell}</span>} {p.message}</li>)}</ul>
  </div>;
}
