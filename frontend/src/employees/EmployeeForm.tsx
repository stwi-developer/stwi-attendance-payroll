import { useEffect, useState } from 'react';
import { api } from '../api';
import { dialog } from '../ui/dialog';
import { DateInput } from '../ui/DateInput';
import { FieldDef, isoDay, showDate } from './fields';

export type Masters = { departments: any[]; designations: any[]; employmentTypes: any[]; reload: () => Promise<void> };

/** Department / designation / employment-type lists for the dropdowns. */
export function useMasters(): Masters {
  const [departments, setDepartments] = useState<any[]>([]);
  const [designations, setDesignations] = useState<any[]>([]);
  const [employmentTypes, setEmploymentTypes] = useState<any[]>([]);
  const reload = async () => {
    const [d, g, t] = await Promise.all([api.departments(), api.designations(), api.employmentTypes()]);
    setDepartments(d); setDesignations(g); setEmploymentTypes(t);
  };
  useEffect(() => { reload().catch(() => {}); }, []);
  return { departments, designations, employmentTypes, reload };
}

const ADD_NEW = '__add_new__';

function FieldInput({ f, value, onChange, masters, disabled }: { f: FieldDef; value: any; onChange: (v: any) => void; masters: Masters; disabled?: boolean }) {
  const addNew = async (kind: 'designation' | 'employmentType') => {
    const label = kind === 'designation' ? 'Designation' : 'Employment Type';
    const v = await dialog.form({ title: `Add ${label}`, message: `Use exactly the same name as in Zoho People.`, fields: [{ name: 'name', label: `${label} name`, type: 'text', required: true }], submitLabel: 'Add' });
    if (!v) return;
    try {
      const created = kind === 'designation' ? await api.addDesignation(v.name) : await api.addEmploymentType(v.name);
      await masters.reload();
      onChange(created.name);
    } catch (e: any) { await dialog.error(e.message); }
  };
  switch (f.kind) {
    case 'department':
      return <select disabled={disabled} value={value ?? ''} onChange={(e) => onChange(e.target.value)}><option value="">Select</option>{masters.departments.map((d) => <option key={d.id} value={d.name}>{d.parent ? `${d.parent.name} › ${d.name}` : d.name}</option>)}</select>;
    case 'designation':
    case 'employmentType': {
      const list = f.kind === 'designation' ? masters.designations : masters.employmentTypes;
      const names = list.map((x) => x.name);
      return <select disabled={disabled} value={value ?? ''} onChange={(e) => (e.target.value === ADD_NEW ? void addNew(f.kind as any) : onChange(e.target.value))}>
        <option value="">Select</option>
        {value && !names.includes(value) && <option value={value}>{value}</option>}
        {names.map((n) => <option key={n} value={n}>{n}</option>)}
        <option value={ADD_NEW}>+ Add new…</option>
      </select>;
    }
    case 'choice':
      return <select disabled={disabled} value={value ?? ''} onChange={(e) => onChange(e.target.value)}><option value="">Select</option>{value && !f.choices?.includes(value) && <option value={value}>{value}</option>}{f.choices?.map((c) => <option key={c} value={c}>{c}</option>)}</select>;
    case 'bool':
      return <label className="switch"><input type="checkbox" disabled={disabled} checked={value !== false && value !== 'false'} onChange={(e) => onChange(e.target.checked)} /><span>{value !== false && value !== 'false' ? 'Yes' : 'No'}</span></label>;
    case 'longtext':
      return <textarea disabled={disabled} rows={2} value={value ?? ''} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />;
    case 'date':
      return <DateInput disabled={disabled} value={isoDay(value)} onChange={onChange} />;
    case 'money':
      return <input disabled={disabled} type="number" min="0" step="0.01" value={value ?? ''} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />;
    case 'email':
      return <input disabled={disabled} type="email" value={value ?? ''} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />;
    default:
      return <input disabled={disabled} value={value ?? ''} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />;
  }
}

/**
 * One titled block of fields. `tone` shows where the data comes from, using
 * the same colours as the Zoho Employee View sheet (yellow = Zoho, green = manual).
 */
export function FormSection({ title, subtitle, tone, fields, values, errors, onChange, masters, readOnly, readOnlyKeys }: {
  title: string; subtitle?: string; tone?: 'zoho' | 'manual' | 'plain'; fields: FieldDef[]; values: Record<string, any>; errors?: Record<string, string>;
  onChange?: (key: string, v: any) => void; masters: Masters; readOnly?: boolean; readOnlyKeys?: string[];
}) {
  return (
    <section className={`form-section tone-${tone ?? 'plain'}`}>
      <div className="form-section-head"><h4>{title}</h4>{subtitle && <span className="muted">{subtitle}</span>}</div>
      <div className="form-grid">
        {fields.map((f) => {
          const ro = readOnly || readOnlyKeys?.includes(f.key);
          const err = errors?.[f.key];
          const wide = f.kind === 'longtext';
          return (
            <div key={f.key} className={`form-field${wide ? ' wide' : ''}${err ? ' has-error' : ''}`}>
              <span className="form-label">{f.label}{f.required && !ro ? <b className="req"> *</b> : null}</span>
              {ro ? <div className="ro-value">{displayValue(f, values[f.key])}</div> : <FieldInput f={f} value={values[f.key]} onChange={(v) => onChange?.(f.key, v)} masters={masters} />}
              {err ? <small className="field-error">{err}</small> : f.help && !ro ? <small className="muted">{f.help}</small> : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function displayValue(f: FieldDef, v: any) {
  if (v === undefined || v === null || v === '') return <span className="muted">—</span>;
  if (f.kind === 'date') return showDate(v);
  if (f.kind === 'bool') return v ? 'Yes' : 'No';
  if (f.kind === 'money') return `₹${Number(v).toLocaleString('en-IN')}`;
  return String(v);
}
