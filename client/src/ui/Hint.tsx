/**
 * A first-run hint: one short, dismissible line of guidance shown where it applies (progressive disclosure, not a
 * tutorial wall). Dismissal is remembered per browser; storage failures (private mode, blocked) simply show it again.
 */
import { useState, type ReactNode } from 'react';
import { Icon } from './Icon';

const key = (id: string) => `tbr-hint-${id}`;
function seen(id: string): boolean {
  try { return window.localStorage.getItem(key(id)) === '1'; } catch { return false; }
}

export function Hint({ id, children }: { id: string; children: ReactNode }) {
  const [hidden, setHidden] = useState(() => seen(id));
  if (hidden) return null;
  const dismiss = () => {
    try { window.localStorage.setItem(key(id), '1'); } catch { /* not remembered; fine */ }
    setHidden(true);
  };
  return (
    <div className="hint" role="note">
      <p>{children}</p>
      <button className="btn btn-quiet btn-small" onClick={dismiss} aria-label="Dismiss hint">Got it <Icon name="check" size={14} /></button>
    </div>
  );
}
