/**
 * App shell: top navigation + hash routing (#/duel, #/duel/:runId, #/runs, #/sim, #/ml).
 * Loads the equipment catalogue once and shares it via context.
 */
import { useEffect, useState } from 'react';
import { api, type Catalog } from './api';
import { CatalogContext, ErrorBox } from './util';
import { DuelView } from './views/DuelView';
import { MlView } from './views/MlView';
import { RunsView } from './views/RunsView';
import { SimView } from './views/SimView';

function useHash(): string {
  const [hash, setHash] = useState(window.location.hash || '#/duel');
  useEffect(() => {
    const on = () => setHash(window.location.hash || '#/duel');
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

const TABS = [
  { hash: '#/duel', label: '⚔ Duel' },
  { hash: '#/runs', label: '📜 Runs' },
  { hash: '#/sim', label: '🎲 Simulations' },
  { hash: '#/ml', label: '🧪 ML Lab' },
];

export function App() {
  const hash = useHash();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => api.catalog().then((c) => { setCatalog(c); setError(null); }).catch((e) => setError(e.message));
  useEffect(() => { void load(); }, []);

  const go = (h: string) => { window.location.hash = h; };
  const [, section, arg] = hash.split('/');
  const runId = section === 'duel' && arg ? Number(arg) : null;

  return (
    <CatalogContext.Provider value={catalog}>
      <header className="topbar">
        <a className="brand" href="#/duel">The Boss Remembers</a>
        <nav>
          {TABS.map((t) => (
            <a key={t.hash} href={t.hash} className={hash.startsWith(t.hash) ? 'active' : ''}>{t.label}</a>
          ))}
        </nav>
      </header>
      <main>
        <ErrorBox error={error} onRetry={load} />
        {section === 'runs' ? <RunsView go={go} />
          : section === 'sim' ? <SimView go={go} />
            : section === 'ml' ? <MlView />
              : <DuelView runId={runId && Number.isInteger(runId) ? runId : null} go={go} />}
      </main>
    </CatalogContext.Provider>
  );
}
