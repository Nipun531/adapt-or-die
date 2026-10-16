/**
 * Shared state components: skeleton loading, honest errors (server unreachable vs a rule refusal), empty states,
 * success notices, a meter with progressbar semantics, an accessible confirm dialog and toasts.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError } from '../api';
import { Icon } from './Icon';

export function Skeleton({ lines = 3, label = 'Loading' }: { lines?: number; label?: string }) {
  return (
    <div className="skeleton" role="status" aria-label={label}>
      {Array.from({ length: lines }, (_, i) => <span key={i} style={{ width: `${90 - i * 14}%` }} />)}
    </div>
  );
}

/** Error box. Network problems say so (and how to fix them); rule refusals show the server's own message. */
export function ErrorBox({ error, onRetry }: { error: string | ApiError | null; onRetry?: () => void }) {
  if (!error) return null;
  const network = error instanceof ApiError && error.kind === 'network';
  const text = typeof error === 'string' ? error : error.message;
  return (
    <div className={`state state-error ${network ? 'state-network' : ''}`} role="alert">
      <Icon name="alert" />
      <div>
        <b>{network ? 'Can’t reach the game server' : 'That didn’t work'}</b>
        <p>{text}</p>
      </div>
      {onRetry && <button className="btn btn-quiet" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function Notice({ text }: { text: string | null }) {
  return text ? <div className="state state-ok" role="status"><Icon name="check" /><p>{text}</p></div> : null;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="state state-empty"><b>{title}</b>{children && <div>{children}</div>}</div>;
}

/** Horizontal meter with progressbar semantics (HP, XP, batch progress). */
export function Meter({ value, max, label, tone = 'neutral' }: { value: number; max: number; label: string; tone?: 'player' | 'boss' | 'xp' | 'neutral' }) {
  const v = Math.max(0, Math.min(value, max));
  return (
    <div className={`meter meter-${tone}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.round(v * 10) / 10}>
      <span style={{ width: `${max > 0 ? (v / max) * 100 : 0}%` }} />
    </div>
  );
}

/** Confirm dialog on the native <dialog> element (focus trap + Escape for free). */
export function useConfirm() {
  const [state, setState] = useState<{ title: string; body: string; action: string; resolve: (ok: boolean) => void } | null>(null);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (state) ref.current?.showModal(); }, [state]);
  const ask = useCallback((title: string, body: string, action: string) => new Promise<boolean>((resolve) => setState({ title, body, action, resolve })), []);
  const close = (ok: boolean) => { ref.current?.close(); state?.resolve(ok); setState(null); };
  const dialog = state ? (
    <dialog ref={ref} className="dialog stock" onCancel={(e) => { e.preventDefault(); close(false); }} aria-labelledby="dlg-title">
      <h3 id="dlg-title">{state.title}</h3>
      <p>{state.body}</p>
      <div className="dialog-actions">
        <button className="btn btn-quiet" onClick={() => close(false)}>Keep playing</button>
        <button className="btn btn-danger" onClick={() => close(true)} autoFocus>{state.action}</button>
      </div>
    </dialog>
  ) : null;
  return { ask, dialog };
}

const ToastCtx = createContext<(msg: string) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);

export function ToastHost({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; msg: string }[]>([]);
  const push = useCallback((msg: string) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs.slice(-2), { id, msg }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 2800);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => <div key={t.id} className="toast"><Icon name="check" size={16} />{t.msg}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}
