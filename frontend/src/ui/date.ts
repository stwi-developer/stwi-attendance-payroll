// V1.9: the STWI date format everywhere in the app: dd/Mmm/yyyy (e.g. 21/Aug/2026).
// Values sent to / received from the server stay ISO (2026-08-21).

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/** Calendar dates (joining date, work date…) are stored at UTC midnight: read them in UTC. */
function isCalendarDate(v: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) || /^\d{4}-\d{2}-\d{2}T00:00:00(\.000)?Z$/.test(v);
}

/** 21/Aug/2026 ("—" when empty). */
export function fmtDate(v?: string | Date | null): string {
  if (v === undefined || v === null || v === '') return '—';
  if (typeof v === 'string' && isCalendarDate(v)) {
    const [y, m, d] = v.slice(0, 10).split('-').map(Number);
    return `${pad(d)}/${MONTHS[m - 1]}/${y}`;
  }
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return `${pad(d.getDate())}/${MONTHS[d.getMonth()]}/${d.getFullYear()}`;
}

/** 28/Sep/2026, 12:49 pm (local time). */
export function fmtDateTime(v?: string | Date | null): string {
  if (v === undefined || v === null || v === '') return '—';
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return `${fmtDate(d)}, ${fmtTime(d, false)}`;
}

/** 09:30 am. `utc` = the time is stored as it appeared in Zoho (attendance check-in/out). */
export function fmtTime(v?: string | Date | null, utc = true): string {
  if (v === undefined || v === null || v === '') return '—';
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  const h = utc ? d.getUTCHours() : d.getHours();
  const m = utc ? d.getUTCMinutes() : d.getMinutes();
  return `${pad(h % 12 || 12)}:${pad(m)} ${h < 12 ? 'am' : 'pm'}`;
}

/** Decimal hours -> Zoho style 08:18. */
export function fmtHours(v?: string | number | null): string {
  if (v === undefined || v === null || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  const total = Math.round(n * 60);
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/** Replaces ISO dates inside a message (e.g. from the server) with dd/Mmm/yyyy. */
export function fmtText(s: string): string {
  return s.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (all, y, m, d) => (Number(m) >= 1 && Number(m) <= 12 ? `${d}/${MONTHS[Number(m) - 1]}/${y}` : all));
}

/** Reads what someone typed: 21/Aug/2026, 21-aug-2026, 21 Aug 2026, 21/08/2026, 2026-08-21. Returns ISO or null. */
export function parseDate(text: string): string | null {
  const s = text.trim();
  if (!s) return null;
  let y: number, m: number, d: number;
  let r = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (r) { y = +r[1]; m = +r[2]; d = +r[3]; }
  else if ((r = s.match(/^(\d{1,2})[\s/.-]+([A-Za-z]{3,9})[\s/.,-]+(\d{4})$/))) {
    const idx = MONTHS.findIndex((x) => x.toLowerCase() === r![2].slice(0, 3).toLowerCase());
    if (idx < 0) return null;
    d = +r[1]; m = idx + 1; y = +r[3];
  } else if ((r = s.match(/^(\d{1,2})[\s/.-]+(\d{1,2})[\s/.-]+(\d{4})$/))) { d = +r[1]; m = +r[2]; y = +r[3]; }
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** ISO date -> dd/Mmm/yyyy for a text box ('' when empty). */
export function isoToText(iso?: string | null) {
  return iso ? fmtDate(String(iso).slice(0, 10)) : '';
}
