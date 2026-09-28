// V1.9: loaders. A thin yellow bar at the top while any data is loading or
// saving, and a "Please wait…" window for long jobs (busy.run).
import { useEffect, useState } from 'react';
import { onLoadingChange } from '../api';

export function LoadingBar() {
  const [n, setN] = useState(0);
  const [show, setShow] = useState(false);
  useEffect(() => onLoadingChange(setN), []);
  useEffect(() => {
    if (n > 0) { const t = setTimeout(() => setShow(true), 120); return () => clearTimeout(t); } // no flicker on very fast calls
    setShow(false);
  }, [n > 0]);
  return <div className={`loading-bar${show ? ' on' : ''}`} role="progressbar" aria-hidden={!show} aria-label="Loading" />;
}

export function Spinner({ small }: { small?: boolean }) { return <span className={`spinner${small ? ' small' : ''}`} aria-hidden="true" />; }

let setOverlay: ((t: string | null) => void) | null = null;
let depth = 0;

export const busy = {
  /** Runs a long job with a "Please wait…" window that blocks clicks. */
  async run<T>(text: string, work: () => Promise<T>): Promise<T> {
    depth++; setOverlay?.(text);
    try { return await work(); } finally { depth--; if (!depth) setOverlay?.(null); }
  },
};

export function BusyHost() {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => { setOverlay = setText; return () => { setOverlay = null; }; }, []);
  if (!text) return null;
  return <div className="busy-backdrop" role="alert" aria-live="assertive"><div className="busy-card"><Spinner /><span>{text}</span></div></div>;
}

/** Placeholder row / block while a list is loading. */
export function LoadingBlock({ text = 'Loading…' }: { text?: string }) { return <div className="empty loading-block"><Spinner small /> {text}</div>; }
