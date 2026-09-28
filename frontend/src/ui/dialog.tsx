// V1.9: STWI popups. Replaces the browser's alert / confirm / prompt boxes.
//
//   await dialog.success('Saved.')                       -> OK popup
//   await dialog.error('Could not save.')                -> red OK popup
//   if (await dialog.confirm({ title, message })) ...    -> Yes / Cancel
//   const v = await dialog.form({ title, fields })       -> values or null
//   const c = await dialog.choice({ title, choices })    -> chosen value or null
//
// <DialogHost/> is mounted once in App and shows the popups one at a time.
import { ReactNode, useEffect, useRef, useState } from 'react';
import { L } from './labels';

export type Tone = 'info' | 'success' | 'warning' | 'error' | 'danger';
export type FieldOption = { value: string; label: string };
export type Field = {
  name: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'textarea' | 'select' | 'radio' | 'checkbox';
  options?: FieldOption[];
  default?: any;
  required?: boolean;
  min?: number;
  max?: number;
  step?: number;
  help?: string;
  placeholder?: string;
};
export type DialogButton = { label: string; value: any; variant?: 'primary' | 'secondary' | 'danger'; submit?: boolean };
export type DialogSpec = {
  tone?: Tone;
  title: string;
  message?: ReactNode;
  fields?: Field[];
  buttons: DialogButton[];
  /** the user must type this exact text before a submit button is enabled */
  confirmText?: string;
  confirmTextLabel?: string;
  wide?: boolean;
};
type Result = { button: any; values: Record<string, any> } | null;
type Pending = DialogSpec & { id: number; resolve: (r: Result) => void };

let pushDialog: ((spec: Pending) => void) | null = null;
let seq = 0;

function open(spec: DialogSpec): Promise<Result> {
  return new Promise((resolve) => {
    if (!pushDialog) { resolve(null); return; }
    pushDialog({ ...spec, id: ++seq, resolve });
  });
}

export const dialog = {
  open,
  async alert(message: ReactNode, opts: { title?: string; tone?: Tone; okLabel?: string; wide?: boolean } = {}) {
    await open({ tone: opts.tone ?? 'info', title: opts.title ?? '', message, wide: opts.wide, buttons: [{ label: opts.okLabel ?? L('btn.ok'), value: true, variant: 'primary', submit: true }] });
  },
  success(message: ReactNode, title?: string) { return dialog.alert(message, { title: title ?? L('popup.success.title'), tone: 'success' }); },
  error(message: ReactNode, title?: string) { return dialog.alert(message, { title: title ?? L('popup.error.title'), tone: 'error' }); },
  async confirm(opts: { title?: string; message?: ReactNode; confirmLabel?: string; cancelLabel?: string; tone?: Tone }) {
    const r = await open({
      tone: opts.tone ?? 'warning',
      title: opts.title ?? L('popup.confirm.title'),
      message: opts.message ?? L('popup.confirm.message'),
      buttons: [
        { label: opts.cancelLabel ?? L('btn.cancel'), value: false, variant: 'secondary' },
        { label: opts.confirmLabel ?? L('btn.yes'), value: true, variant: opts.tone === 'danger' ? 'danger' : 'primary', submit: true },
      ],
    });
    return !!r?.button;
  },
  async form(opts: { title: string; message?: ReactNode; fields: Field[]; submitLabel?: string; cancelLabel?: string; tone?: Tone; wide?: boolean }) {
    const r = await open({
      tone: opts.tone ?? 'info', title: opts.title, message: opts.message, fields: opts.fields, wide: opts.wide,
      buttons: [
        { label: opts.cancelLabel ?? L('btn.cancel'), value: false, variant: 'secondary' },
        { label: opts.submitLabel ?? L('btn.save'), value: true, variant: 'primary', submit: true },
      ],
    });
    return r?.button ? r.values : null;
  },
  async choice<T = string>(opts: { title: string; message?: ReactNode; choices: { label: string; value: T }[]; cancelLabel?: string; tone?: Tone }) {
    const r = await open({
      tone: opts.tone ?? 'info', title: opts.title, message: opts.message,
      buttons: [
        { label: opts.cancelLabel ?? L('btn.cancel'), value: null, variant: 'secondary' },
        ...opts.choices.map((c) => ({ label: c.label, value: c.value, variant: 'primary' as const })),
      ],
    });
    return (r?.button ?? null) as T | null;
  },
};

const ICON: Record<Tone, string> = { info: 'i', success: '✓', warning: '!', error: '✕', danger: '!' };

function initialValues(fields: Field[] = []) {
  const v: Record<string, any> = {};
  for (const f of fields) v[f.name] = f.default ?? (f.type === 'checkbox' ? false : '');
  return v;
}

function DialogCard({ spec, onDone }: { spec: Pending; onDone: (r: Result) => void }) {
  const [values, setValues] = useState<Record<string, any>>(() => initialValues(spec.fields));
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');
  const cardRef = useRef<HTMLDivElement>(null);
  const tone = spec.tone ?? 'info';
  const cancelButton = spec.buttons.find((b) => b.variant === 'secondary');

  useEffect(() => {
    const el = cardRef.current?.querySelector<HTMLElement>('input,select,textarea') ?? cardRef.current?.querySelector<HTMLElement>('.modal-foot button:last-child');
    el?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onDone(cancelButton ? { button: cancelButton.value, values } : null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const confirmOk = !spec.confirmText || typed.trim() === spec.confirmText;

  const click = (b: DialogButton) => {
    if (b.submit || b.variant === 'primary' || b.variant === 'danger') {
      if (b.submit && !confirmOk) return;
      if (b.submit) {
        for (const f of spec.fields ?? []) {
          const v = values[f.name];
          if (f.required && (v === '' || v === null || v === undefined)) { setError(`${f.label} is required.`); return; }
          if (f.type === 'number' && v !== '') {
            const n = Number(v);
            if (!Number.isFinite(n)) { setError(`${f.label} must be a number.`); return; }
            if (f.min !== undefined && n < f.min) { setError(`${f.label} must be at least ${f.min}.`); return; }
            if (f.max !== undefined && n > f.max) { setError(`${f.label} must be at most ${f.max}.`); return; }
          }
        }
      }
    }
    onDone({ button: b.value, values });
  };

  const set = (k: string, v: any) => { setError(''); setValues((s) => ({ ...s, [k]: v })); };

  return (
    <div className="modal-backdrop" role="presentation">
      <div ref={cardRef} className={`modal modal-${tone}${spec.wide ? ' modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={`dlg-${spec.id}`}>
        <div className="modal-head">
          <span className="modal-icon" aria-hidden="true">{ICON[tone]}</span>
          <h3 id={`dlg-${spec.id}`}>{spec.title}</h3>
        </div>
        <form className="modal-body" onSubmit={(e) => { e.preventDefault(); const s = spec.buttons.find((b) => b.submit); if (s) click(s); }}>
          {spec.message !== undefined && spec.message !== '' && <div className="modal-message">{spec.message}</div>}
          {spec.fields?.map((f) => (
            <div className="modal-field" key={f.name}>
              {f.type === 'checkbox' ? (
                <label className="check"><input type="checkbox" checked={!!values[f.name]} onChange={(e) => set(f.name, e.target.checked)} /> {f.label}</label>
              ) : f.type === 'radio' ? (
                <fieldset><legend>{f.label}</legend><div className="radio-row">{f.options?.map((o) => (
                  <label key={o.value} className={`radio-pill${values[f.name] === o.value ? ' on' : ''}`}><input type="radio" name={f.name} checked={values[f.name] === o.value} onChange={() => set(f.name, o.value)} />{o.label}</label>
                ))}</div></fieldset>
              ) : (
                <label>{f.label}{f.required ? ' *' : ''}
                  {f.type === 'select' ? (
                    <select value={values[f.name]} onChange={(e) => set(f.name, e.target.value)}><option value="">Select</option>{f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
                  ) : f.type === 'textarea' ? (
                    <textarea rows={3} value={values[f.name]} placeholder={f.placeholder} onChange={(e) => set(f.name, e.target.value)} />
                  ) : (
                    <input type={f.type} value={values[f.name]} min={f.min} max={f.max} step={f.step ?? (f.type === 'number' ? 'any' : undefined)} placeholder={f.placeholder} onChange={(e) => set(f.name, e.target.value)} />
                  )}
                </label>
              )}
              {f.help && <small className="muted">{f.help}</small>}
            </div>
          ))}
          {spec.confirmText && (
            <label className="modal-field">{spec.confirmTextLabel ?? `Type ${spec.confirmText} to confirm`}
              <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
            </label>
          )}
          {error && <div className="modal-err">{error}</div>}
          <div className="modal-foot">
            {spec.buttons.map((b, i) => (
              <button key={i} type={b.submit ? 'submit' : 'button'} className={`btn-${b.variant ?? 'secondary'}`} disabled={b.submit && !confirmOk} onClick={b.submit ? undefined : () => click(b)}>{b.label}</button>
            ))}
          </div>
        </form>
      </div>
    </div>
  );
}

export function DialogHost() {
  const [queue, setQueue] = useState<Pending[]>([]);
  useEffect(() => {
    pushDialog = (p) => setQueue((q) => [...q, p]);
    return () => { pushDialog = null; };
  }, []);
  const current = queue[0];
  if (!current) return null;
  return <DialogCard key={current.id} spec={current} onDone={(r) => { current.resolve(r); setQueue((q) => q.slice(1)); }} />;
}

/** A plain popup shell for screens that need their own content (e.g. the delete danger zone). */
export function Modal({ tone = 'info', title, children, footer, wide, onClose }: { tone?: Tone; title: string; children: ReactNode; footer: ReactNode; wide?: boolean; onClose: () => void }) {
  useEffect(() => {
    // ignore Escape while a popup is open on top of this window
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && document.querySelectorAll('.modal-backdrop').length < 2) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" role="presentation">
      <div className={`modal modal-${tone}${wide ? ' modal-wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-head"><span className="modal-icon" aria-hidden="true">{ICON[tone]}</span><h3>{title}</h3></div>
        <div className="modal-body">{children}<div className="modal-foot">{footer}</div></div>
      </div>
    </div>
  );
}
