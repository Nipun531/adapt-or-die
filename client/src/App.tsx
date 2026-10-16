/**
 * App shell: baize top bar (brand, Duel, Workshop menu) + hash routing (#/duel, #/duel/:runId, #/runs, #/sim, #/ml).
 * The Duel is the product; Runs, Simulations and ML Lab are the developer's Workshop.
 * Loads the equipment catalogue once and shares it via context.
 */
import { useEffect, useRef, useState } from 'react';
import { api, type Catalog } from './api';
import { Icon } from './ui/Icon';
import { ErrorBox, ToastHost } from './ui/states';
import { CatalogContext } from './util';
import { DuelView } from './views/DuelView';
import { MlView } from './views/MlView';
import { RunsView } from './views/RunsView';
import { SimView } from './views/SimView';
import { ApiError } from './api';

function useHash(): string {
  const [hash, setHash] = useState(window.location.hash || '#/duel');
  useEffect(() => {
    const on = () => setHash(window.location.hash || '#/duel');
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

const WORKSHOP = [
  { hash: '#/runs', label: 'Runs', hint: 'every manual and simulated run' },
  { hash: '#/sim', label: 'Simulations', hint: 'agents vs the boss, in batches' },
  { hash: '#/ml', label: 'ML Lab', hint: 'data, models, activation' },
];

function WorkshopMenu({ hash }: { hash: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  useEffect(() => setOpen(false), [hash]);
  const current = WORKSHOP.find((w) => hash.startsWith(w.hash));
  return (
    <div className="menu" ref={ref}>
      <button className={`nav-link ${current ? 'is-current' : ''}`} aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(!open)}>
        Workshop{current ? `: ${current.label}` : ''} <Icon name="chevron" size={16} />
      </button>
      {open && (
        <ul className="menu-list stock" role="menu">
          {WORKSHOP.map((w) => (
            <li key={w.hash} role="none">
              <a role="menuitem" href={w.hash} className={hash.startsWith(w.hash) ? 'is-current' : ''}><b>{w.label}</b><span>{w.hint}</span></a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function App() {
  const hash = useHash();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const load = () => api.catalog().then((c) => { setCatalog(c); setError(null); }).catch((e) => setError(e));
  useEffect(() => { void load(); }, []);

  const go = (h: string) => { window.location.hash = h; };
  const [, section, arg] = hash.split('/');
  const runId = section === 'duel' && arg ? Number(arg) : null;
  const inDuel = !['runs', 'sim', 'ml'].includes(section);

  return (
    <CatalogContext.Provider value={catalog}>
      <ToastHost>
        <a className="skip" href="#main">Skip to content</a>
        <header className="topbar">
          <a className="brand" href="#/duel" aria-label="The Boss Remembers — start">
            <span className="brand-mark" aria-hidden="true"><Icon name="crown" size={18} /></span>
            The Boss Remembers
          </a>
          <nav aria-label="Main">
            <a className={`nav-link ${inDuel ? 'is-current' : ''}`} href="#/duel" aria-current={inDuel ? 'page' : undefined}>Duel</a>
            <WorkshopMenu hash={hash} />
          </nav>
        </header>
        <main id="main" className="page">
          <ErrorBox error={error} onRetry={load} />
          {section === 'runs' ? <RunsView go={go} />
            : section === 'sim' ? <SimView go={go} />
              : section === 'ml' ? <MlView />
                : <DuelView runId={runId && Number.isInteger(runId) ? runId : null} go={go} />}
        </main>
      </ToastHost>
    </CatalogContext.Provider>
  );
}
