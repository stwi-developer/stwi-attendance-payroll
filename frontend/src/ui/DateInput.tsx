// V1.9: date box in the STWI format dd/Mmm/yyyy with a small calendar.
// Type 21/Aug/2026 (or 21/08/2026, 21-aug-2026) or pick a day. The value
// given to / received from the form is ISO (2026-08-21) or ''.
import { useEffect, useRef, useState } from 'react';
import { isoToText, MONTHS, parseDate } from './date';

type Props = { value?: string | null; onChange: (iso: string) => void; disabled?: boolean; placeholder?: string; id?: string; ariaLabel?: string; /** month the calendar opens on when empty (ISO) */ defaultView?: string };

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export function DateInput({ value, onChange, disabled, placeholder = 'dd/mmm/yyyy', id, ariaLabel, defaultView }: Props) {
  const iso = value ? String(value).slice(0, 10) : '';
  const [text, setText] = useState(isoToText(iso));
  const [bad, setBad] = useState(false);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => { const b = iso || today(); return { y: +b.slice(0, 4), m: +b.slice(5, 7) - 1 }; });
  const box = useRef<HTMLDivElement>(null);

  // keep the text in step when the value changes from outside
  useEffect(() => { setText(isoToText(iso)); setBad(false); }, [iso]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc, true); };
  }, [open]);

  const commit = (t: string) => {
    if (!t.trim()) { setBad(false); if (iso) onChange(''); return; }
    const p = parseDate(t);
    if (!p) { setBad(true); return; }
    setBad(false); setText(isoToText(p));
    if (p !== iso) onChange(p);
  };
  const pick = (y: number, m: number, d: number) => {
    const p = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    setText(isoToText(p)); setBad(false); setOpen(false); onChange(p);
  };
  const openCal = () => {
    if (disabled) return;
    const b = parseDate(text) || iso || defaultView || today();
    setView({ y: +b.slice(0, 4), m: +b.slice(5, 7) - 1 });
    setOpen((o) => !o);
  };

  const first = new Date(Date.UTC(view.y, view.m, 1)).getUTCDay(); // 0 = Sunday
  const days = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
  const cells: (number | null)[] = [...Array((first + 6) % 7).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const move = (n: number) => setView((v) => { const m = v.m + n; return { y: v.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 }; });
  const selected = iso ? { y: +iso.slice(0, 4), m: +iso.slice(5, 7) - 1, d: +iso.slice(8, 10) } : null;
  const t = today();

  return (
    <div className={`date-input${bad ? ' bad' : ''}${disabled ? ' disabled' : ''}`} ref={box}>
      <input id={id} aria-label={ariaLabel} value={text} disabled={disabled} placeholder={placeholder} autoComplete="off"
        onChange={(e) => { setText(e.target.value); setBad(false); }}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit((e.target as HTMLInputElement).value); } if (e.key === 'ArrowDown') { e.preventDefault(); openCal(); } }} />
      <button type="button" className="date-btn" tabIndex={-1} disabled={disabled} onClick={openCal} aria-label="Open calendar">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M7 2v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2H7zm-2 8h14v10H5V10z" /></svg>
      </button>
      {bad && <small className="date-hint">Use dd/mmm/yyyy, e.g. 21/Aug/2026</small>}
      {open && (
        <div className="cal" role="dialog" aria-label="Choose date">
          <div className="cal-head">
            <button type="button" onClick={() => move(-1)} aria-label="Previous month">‹</button>
            <select value={view.m} onChange={(e) => setView({ ...view, m: +e.target.value })}>{MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}</select>
            <input type="number" value={view.y} onChange={(e) => setView({ ...view, y: +e.target.value || view.y })} />
            <button type="button" onClick={() => move(1)} aria-label="Next month">›</button>
          </div>
          <div className="cal-grid">
            {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => <span key={d} className="cal-dow">{d}</span>)}
            {cells.map((d, i) => d === null ? <span key={i} /> : (
              <button type="button" key={i}
                className={`cal-day${selected && selected.y === view.y && selected.m === view.m && selected.d === d ? ' on' : ''}${t === `${view.y}-${String(view.m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}` ? ' today' : ''}`}
                onClick={() => pick(view.y, view.m, d)}>{d}</button>
            ))}
          </div>
          <div className="cal-foot">
            <button type="button" onClick={() => { const x = today(); pick(+x.slice(0, 4), +x.slice(5, 7) - 1, +x.slice(8, 10)); }}>Today</button>
            <button type="button" onClick={() => { setText(''); setOpen(false); if (iso) onChange(''); }}>Clear</button>
          </div>
        </div>
      )}
    </div>
  );
}
